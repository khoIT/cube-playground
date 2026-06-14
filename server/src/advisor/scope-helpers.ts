/**
 * Helpers to translate a ScopeRef (segment or game) into Cube query filters
 * and extract the game id. Centralises the scope→filter conversion so all
 * lenses use one path and no lens hardcodes a game's identity dimension.
 *
 * SegmentRef: the segment's predicate tree is compiled to Cube filters via the
 * translator. GameRef: no extra filter — full game population.
 *
 * Lenses import this module instead of knowing about segment predicates directly.
 */

import type { ScopeRef, SegmentRef } from './diagnosis-types.js';

export type CubeFilterShape = Record<string, unknown>;

/**
 * Derive Cube filter objects for the scope.
 * - GameRef  → empty array (full population).
 * - SegmentRef → the segment's compiled Cube filters (loaded by the engine
 *   and attached as `compiledFilters` before passing to lenses).
 *
 * The compiled filters are attached by the engine after calling
 * treeToCubeFilters; the SegmentRef is extended at runtime with
 * `compiledFilters`. This keeps lenses pure — they never call the translator.
 */
export function scopeToFilters(scope: ScopeRef): unknown[] {
  if (scope.kind === 'game') return [];
  // compiledFilters is attached by the engine at dispatch time.
  const extended = scope as SegmentRef & { compiledFilters?: unknown[] };
  return extended.compiledFilters ?? [];
}

/** Extract the gameId from any ScopeRef. */
export function gameIdFromScope(scope: ScopeRef): string {
  return scope.gameId;
}

/**
 * Map a gameId to the logical cube prefix used by the member resolver.
 * cfm_vn → "cfm", jus_vn → "jus", etc. Falls back to stripping "_vn" suffix.
 */
export function gamePrefix(gameId: string): string | null {
  const MAP: Record<string, string> = {
    cfm_vn: 'cfm',
    jus_vn: 'jus',
    ballistar_vn: 'ballistar',
    pubg_vn: 'pubg',
    muaw_vn: 'muaw',
  };
  return MAP[gameId] ?? null;
}

/**
 * Return a Cube filter that restricts a time dimension to a `days`-long window
 * ending `offsetDays` before asOf. With offsetDays=0 (default) this is the
 * trailing-`days` window; offsetDays=30 with days=30 is the preceding 30-day
 * window (days 30–60 ago). Keeping each window ≤ a high-volume cube's max span
 * (e.g. billing_detail caps at 31 days) is the caller's responsibility.
 * Produces { member, operator:'inDateRange', values:[start, end] }.
 */
export function trailingWindowFilter(
  dimension: string,
  asOf: Date,
  days: number,
  offsetDays = 0,
): CubeFilterShape {
  const dayMs = 24 * 60 * 60 * 1000;
  const end = new Date(asOf.getTime() - offsetDays * dayMs).toISOString().slice(0, 10);
  const start = new Date(asOf.getTime() - (offsetDays + days) * dayMs).toISOString().slice(0, 10);
  return { member: dimension, operator: 'inDateRange', values: [start, end] };
}
