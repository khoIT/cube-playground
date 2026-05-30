/**
 * Golden-query seeder (Snowflake-Cortex-style): mine real, validated queries
 * already in the system to surface which measures/dimensions actually matter
 * and which co-occur, so the triage canvas can badge seeded members with
 * "seen in N real queries".
 *
 * Sources (open both DBs — chat DB ≠ server DB):
 *   - server DB `dashboard_tiles.query_json` — high-confidence saved queries.
 *   - chat DB `chat_turns.artifacts_json` (CHAT_DB_PATH) — QueryArtifact.query.
 *     Best-effort: skipped silently if the chat DB is absent/unreadable.
 *
 * Output is a cached frequency + co-occurrence index. Members are matched by
 * BARE name (`measure`/`dimension`) so a freshly-scaffolded cube — whose fully-
 * qualified names don't exist in history yet — can still be badged by column.
 *
 * Pure of side effects beyond a read-through cache; feature-flagged off by the
 * caller (`onboarding.goldenSeeding`), so v1 heuristic is unchanged when off.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { getDb } from '../db/sqlite.js';

interface CubeQueryLike {
  measures?: string[];
  dimensions?: string[];
  timeDimensions?: Array<{ dimension?: string; granularity?: string }>;
  segments?: string[];
}

export interface GoldenIndex {
  /** Bare member name → number of queries it appears in. */
  memberFrequency: Record<string, number>;
  /** measure (bare) → { dimension (bare) → co-occurrence count }. */
  coOccurrence: Record<string, Record<string, number>>;
  /** Total distinct queries mined. */
  totalQueries: number;
  builtAt: string;
}

const CACHE_TTL_MS = 5 * 60_000;
let cache: { index: GoldenIndex; at: number } | null = null;

/** `cube.member` → `member`; bare names pass through. */
function bare(ref: string): string {
  const dot = ref.lastIndexOf('.');
  return dot >= 0 ? ref.slice(dot + 1) : ref;
}

function chatDbPath(): string | null {
  const p = process.env.CHAT_DB_PATH;
  if (p && existsSync(p)) return p;
  return null;
}

/** Pull CubeQuery-shaped objects from the server's dashboard_tiles. */
function serverQueries(): CubeQueryLike[] {
  try {
    const rows = getDb().prepare(`SELECT query_json FROM dashboard_tiles`).all() as Array<{ query_json: string }>;
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.query_json) as CubeQueryLike;
        } catch {
          return null;
        }
      })
      .filter((q): q is CubeQueryLike => q !== null);
  } catch {
    return [];
  }
}

/** Pull CubeQuery-shaped objects from chat_turns.artifacts_json (chat DB). */
function chatQueries(): CubeQueryLike[] {
  const path = chatDbPath();
  if (!path) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(`SELECT artifacts_json FROM chat_turns WHERE artifacts_json IS NOT NULL`)
      .all() as Array<{ artifacts_json: string }>;
    const out: CubeQueryLike[] = [];
    for (const r of rows) {
      try {
        const arts = JSON.parse(r.artifacts_json) as Array<{ query?: CubeQueryLike }>;
        for (const a of Array.isArray(arts) ? arts : []) {
          if (a?.query) out.push(a.query);
        }
      } catch {
        /* skip malformed artifact blob */
      }
    }
    return out;
  } catch {
    return []; // chat DB absent or schema mismatch — best-effort
  } finally {
    db?.close();
  }
}

function buildIndex(): GoldenIndex {
  const queries = [...serverQueries(), ...chatQueries()];
  const memberFrequency: Record<string, number> = {};
  const coOccurrence: Record<string, Record<string, number>> = {};

  for (const q of queries) {
    const measures = (q.measures ?? []).map(bare);
    const dimensions = [
      ...(q.dimensions ?? []).map(bare),
      ...(q.timeDimensions ?? []).map((t) => (t.dimension ? bare(t.dimension) : '')).filter(Boolean),
    ];
    for (const m of new Set([...measures, ...dimensions])) {
      memberFrequency[m] = (memberFrequency[m] ?? 0) + 1;
    }
    for (const m of measures) {
      coOccurrence[m] ??= {};
      for (const d of dimensions) {
        coOccurrence[m][d] = (coOccurrence[m][d] ?? 0) + 1;
      }
    }
  }

  return { memberFrequency, coOccurrence, totalQueries: queries.length, builtAt: new Date().toISOString() };
}

/** Build (or return cached) golden index. Scan is bounded by the cache TTL. */
export function getGoldenIndex(force = false): GoldenIndex {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.index;
  const index = buildIndex();
  cache = { index, at: Date.now() };
  return index;
}

/** "Seen in N real queries" for one bare member name. */
export function memberSeenCount(member: string, index = getGoldenIndex()): number {
  return index.memberFrequency[bare(member)] ?? 0;
}

/** Test-only reset. */
export function __resetGoldenCache(): void {
  cache = null;
}
