/**
 * Loader for the blessed segmentable-measures catalog.
 *
 * Maps a measure *concept* (spend / spend_usd / active_days) for a game to the
 * per-user dimension that carries it and everything the percentile cutoff needs:
 *   - `dimension`      — the LOGICAL Cube member the membership query filters on.
 *   - `physicalTable`  /`physicalColumn` — the raw Trino target `approx_percentile`
 *                        is taken over (the membership query resolves the logical
 *                        member to the same physical value, so cohort == cutoff pop).
 *   - `defaultPopulation` — reference population for the cutoff (payers, for spend).
 *   - `identityMerge`  — per-user collapse for multi-row marts (jus).
 *
 * The catalog is also the ALLOWLIST of valid cutoff targets: `isCatalogTarget`
 * gates `/resolve-cutoff` and create so a caller can't point the percentile
 * subquery at an arbitrary table/column.
 *
 * Regenerate the data file with `node scripts/derive-segmentable-measures.mjs`.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalGameId, schemaForGame } from './trino-profiler-config.js';
import type { PredicateNode, IdentityMerge, PopulationRef } from '../types/predicate-tree.js';

export interface SegmentableMeasure {
  game: string;
  concept: string;
  label: string;
  cube: string;
  /** Logical Cube member the segment predicate filters on (membership query). */
  dimension: string;
  window: 'lifetime' | '30d' | string;
  currency: 'vnd' | 'usd' | null;
  /** Fully-qualified physical Trino table the cutoff is computed over. */
  physicalTable: string;
  /** Physical column the percentile is taken over. */
  physicalColumn: string;
  /** Reference population for the cutoff (payers for spend; null = full table). */
  defaultPopulation: PredicateNode | null;
  /** Per-user collapse for multi-row identity marts (jus); null for clean tables. */
  identityMerge: IdentityMerge | null;
  confidence: number;
}

interface CatalogFile {
  version: number;
  entries: SegmentableMeasure[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data', 'segmentable-measures.json');

let cached: SegmentableMeasure[] | null = null;

function load(): SegmentableMeasure[] {
  if (cached) return cached;
  try {
    cached = (JSON.parse(readFileSync(DATA, 'utf8')) as CatalogFile).entries ?? [];
  } catch {
    cached = [];
  }
  return cached;
}

/** Match a request's game id to a catalog row (accepts `cfm` or `cfm_vn`). */
function gameMatches(requested: string, entryGame: string): boolean {
  if (requested === entryGame) return true;
  // The catalog keys on the schema-suffixed id (cfm_vn); accept the bare id too.
  return schemaForGame(canonicalGameId(requested)) === entryGame;
}

/** All segmentable measures for a game (empty when the game isn't catalogued). */
export function getSegmentableMeasures(game: string): SegmentableMeasure[] {
  return load().filter((m) => gameMatches(game, m.game));
}

/** One concept for a game, or null when not catalogued (caller must then ask, not guess). */
export function findSegmentableMeasure(game: string, concept: string): SegmentableMeasure | null {
  return getSegmentableMeasures(game).find((m) => m.concept === concept) ?? null;
}

/**
 * The reusable `over` spec (everything but `p`) for a percentile over this
 * measure: physical table+column, the default payer population, and any
 * identity merge. Chat threads this into a `percentileGte`/`Lte` leaf.
 */
export function percentileOverFor(m: SegmentableMeasure): PopulationRef {
  return {
    table: m.physicalTable,
    column: m.physicalColumn,
    ...(m.defaultPopulation ? { filter: m.defaultPopulation } : {}),
    ...(m.identityMerge ? { identityMerge: m.identityMerge } : {}),
  };
}

/**
 * Allowlist guard: is (table, column) a catalogued cutoff target for the game?
 * Gates the percentile subquery against an arbitrary table/column reference.
 */
export function isCatalogTarget(game: string, table: string, column: string): boolean {
  return getSegmentableMeasures(game).some(
    (m) => m.physicalTable === table && m.physicalColumn === column,
  );
}

/** Test-only cache reset. */
export function __resetCatalogCache(): void {
  cached = null;
}
