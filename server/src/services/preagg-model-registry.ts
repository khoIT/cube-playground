/**
 * Model-derived pre-agg probe registry.
 *
 * The readiness matrix used to probe a hand-curated cube list
 * (PREAGG_REGISTRY), which silently diverges from reality: games whose models
 * define rollups on OTHER cubes (ptg: recharge, ordered_funnel_canonical)
 * showed five all-error cells for cubes they don't have, while their real
 * rollups were invisible. This module derives the registry per game from the
 * in-repo Cube model — the same YAML the serving stack vendors — so the matrix
 * always matches what the worker can actually build.
 *
 * Game dirs use the schema short name (cubes/cfm/, cubes/jus/) while the games
 * config uses full ids (cfm_vn, jus_vn): a dir matches a game id when equal or
 * when the id is `<dir>_<suffix>`.
 *
 * Returns null when no model dir matches (caller falls back to the static
 * registry — e.g. prod containers that don't ship cube-dev), and [] when the
 * dir exists but defines no rollups (an honest "this game has none").
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import type { PreaggRegistryEntry } from './preagg-readiness.js';

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  at: number;
  entries: PreaggRegistryEntry[] | null;
}

const cache = new Map<string, CacheEntry>();

/** Test-only reset. */
export function __resetModelRegistryCache(): void {
  cache.clear();
}

function modelCubesDir(): string | null {
  const fromEnv = process.env.PREAGG_MODEL_CUBES_DIR;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  // Host dev server runs from server/ (repo root one up); tests/tools may run
  // from the repo root itself.
  for (const candidate of [
    resolve(process.cwd(), '..', 'cube-dev/cube/model/cubes'),
    resolve(process.cwd(), 'cube-dev/cube/model/cubes'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Pick the game's model dir: exact id match, else `<dir>_<suffix>` prefix. */
function resolveGameDir(root: string, gameId: string): string | null {
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }
  const match =
    dirs.find((d) => d === gameId) ??
    // Longest matching short name wins (defensive against nested prefixes).
    dirs
      .filter((d) => gameId.startsWith(`${d}_`))
      .sort((a, b) => b.length - a.length)[0];
  return match ? join(root, match) : null;
}

/** Qualify a bare member name with its cube; tolerate already-qualified refs. */
function qualify(cube: string, member: string): string {
  const bare = member.startsWith('CUBE.') ? member.slice('CUBE.'.length) : member;
  return bare.includes('.') ? bare : `${cube}.${bare}`;
}

interface ModelPreagg {
  type?: string;
  measures?: unknown[];
  time_dimension?: string;
  granularity?: string;
}

interface ModelCube {
  name?: string;
  pre_aggregations?: ModelPreagg[];
}

/** Extract one probe entry per pre-agg-bearing cube from a parsed YAML doc. */
function entriesFromDoc(doc: unknown, out: PreaggRegistryEntry[]): void {
  const cubes = (doc as { cubes?: ModelCube[] })?.cubes;
  if (!Array.isArray(cubes)) return;
  for (const cube of cubes) {
    if (!cube?.name || !Array.isArray(cube.pre_aggregations)) continue;
    // First plain rollup with a measure + time dimension is probeable;
    // rollup_lambda entries reference other rollups and carry neither.
    const rollup = cube.pre_aggregations.find(
      (p) =>
        (p?.type ?? 'rollup') === 'rollup' &&
        Array.isArray(p?.measures) && p.measures.length > 0 &&
        typeof p?.time_dimension === 'string',
    );
    if (!rollup) continue;
    out.push({
      cube: cube.name,
      measure: qualify(cube.name, String(rollup.measures![0])),
      timeDimension: qualify(cube.name, rollup.time_dimension as string),
      // Probe must query at the rollup's grain (monthly rollup ⇒ monthly query),
      // else routing falls through to source. Defaults to 'day' when omitted.
      granularity: typeof rollup.granularity === 'string' ? rollup.granularity : 'day',
    });
  }
}

/**
 * The probe registry for one game, derived from its model dir.
 * null → no model available (fall back to the static registry).
 */
export function getModelPreaggRegistry(gameId: string): PreaggRegistryEntry[] | null {
  const hit = cache.get(gameId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.entries;

  let entries: PreaggRegistryEntry[] | null = null;
  const root = modelCubesDir();
  if (root) {
    const dir = resolveGameDir(root, gameId);
    if (dir) {
      entries = [];
      let files: string[] = [];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
      } catch {
        entries = null;
      }
      for (const f of files) {
        try {
          entriesFromDoc(loadYaml(readFileSync(join(dir, f), 'utf8')), entries as PreaggRegistryEntry[]);
        } catch {
          // One malformed YAML must not blank the game's whole registry.
        }
      }
    }
  }

  cache.set(gameId, { at: Date.now(), entries });
  return entries;
}
