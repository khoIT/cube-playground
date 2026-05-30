/**
 * Read-only reader for the committed cube-dev model YAMLs. Renders the EXISTING
 * Trino connection's data model (cubes / dimensions / measures / joins) as the
 * worked example in /data — the baseline a DA imitates when modeling a new
 * source. Strictly read-only: never writes, mirrors the writer's model-root
 * resolution (`VITE_CUBE_MODEL_DIR`) inverted, with the same traversal guards.
 *
 * Authoring view (the YAML on disk), NOT the compiled /meta view — UI copy
 * should say so. Tolerant of a missing/unmounted model dir (returns
 * configured:false instead of throwing) so /data degrades gracefully.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const SEGMENT_RE = /^[a-z][a-z0-9_]*$/;

export interface ExistingDimension {
  name: string;
  type: string;
  sql?: string;
  primaryKey?: boolean;
  description?: string;
}
export interface ExistingMeasure {
  name: string;
  type: string;
  sql?: string;
  description?: string;
}
export interface ExistingJoin {
  name: string;
  relationship: string;
  sql: string;
}
export interface ExistingCube {
  name: string;
  sqlTable: string;
  title?: string;
  description?: string;
  file: string;
  dimensions: ExistingDimension[];
  measures: ExistingMeasure[];
  joins: ExistingJoin[];
}
export interface ExistingModel {
  game: string;
  /** False when VITE_CUBE_MODEL_DIR is unset or the game dir is absent. */
  configured: boolean;
  cubes: ExistingCube[];
}

interface RawCube {
  name?: string;
  sql_table?: string;
  title?: string;
  description?: string;
  dimensions?: Array<Record<string, unknown>>;
  measures?: Array<Record<string, unknown>>;
  joins?: Array<Record<string, unknown>>;
}

// mtime-keyed cache: re-read only when the game dir changes on disk.
const cache = new Map<string, { key: string; model: ExistingModel }>();

function modelRoot(): string | null {
  const raw = process.env.VITE_CUBE_MODEL_DIR;
  return raw ? path.resolve(raw) : null;
}

function gameDir(root: string, game: string): string {
  const dir = path.resolve(root, 'cubes', game);
  // Defense-in-depth: the resolved dir must sit exactly under cubes/<game>.
  if (path.dirname(dir) !== path.resolve(root, 'cubes') || !dir.startsWith(root + path.sep)) {
    throw new Error('path-traversal');
  }
  return dir;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function mapCube(raw: RawCube, file: string): ExistingCube {
  const dims = (raw.dimensions ?? []).map((d) => ({
    name: String(d.name ?? ''),
    type: String(d.type ?? 'string'),
    sql: str(d.sql),
    primaryKey: d.primary_key === true,
    description: str(d.description),
  }));
  const measures = (raw.measures ?? []).map((m) => ({
    name: String(m.name ?? ''),
    type: String(m.type ?? 'count'),
    sql: str(m.sql),
    description: str(m.description),
  }));
  const joins = (raw.joins ?? []).map((j) => ({
    name: String(j.name ?? ''),
    relationship: String(j.relationship ?? ''),
    sql: String(j.sql ?? ''),
  }));
  return {
    name: String(raw.name ?? path.basename(file, '.yml')),
    sqlTable: String(raw.sql_table ?? ''),
    title: str(raw.title),
    description: str(raw.description),
    file: path.basename(file),
    dimensions: dims,
    measures,
    joins,
  };
}

function readDir(dir: string, game: string): ExistingModel {
  const cubes: ExistingCube[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.yml') || x.endsWith('.yaml')).sort()) {
    try {
      const doc = yaml.load(readFileSync(path.join(dir, f), 'utf8')) as { cubes?: RawCube[] } | null;
      for (const c of doc?.cubes ?? []) cubes.push(mapCube(c, f));
    } catch {
      // skip an unparseable file rather than failing the whole read
    }
  }
  return { game, configured: true, cubes };
}

/**
 * Read the existing model for a game. Returns `configured:false` when the model
 * dir isn't mounted or the game has no cubes dir. mtime-cached per game.
 */
export function readExistingModel(game: string): ExistingModel {
  if (!SEGMENT_RE.test(game)) return { game, configured: false, cubes: [] };
  const root = modelRoot();
  if (!root) return { game, configured: false, cubes: [] };

  let dir: string;
  try {
    dir = gameDir(root, game);
  } catch {
    return { game, configured: false, cubes: [] };
  }
  if (!existsSync(dir)) return { game, configured: false, cubes: [] };

  const key = `${dir}:${statSync(dir).mtimeMs}`;
  const hit = cache.get(game);
  if (hit && hit.key === key) return hit.model;

  const model = readDir(dir, game);
  cache.set(game, { key, model });
  return model;
}

/** Test-only cache reset. */
export function __resetExistingModelCache(): void {
  cache.clear();
}
