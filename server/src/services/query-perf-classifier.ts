/**
 * Pure pre-agg-hit + rollup-matchability classifier.
 *
 * Given a captured query's NAMES-only shape + the per-game rollup registry view,
 * decide (a) whether the query was served by a pre-aggregation and (b) whether
 * its shape could EVER be served by one. Drives the optimization playbooks: a
 * per-user row-listing is `unmatchable` → no rollup will ever help → the remedy
 * is a materialized snapshot, NOT "add a rollup".
 *
 * CRITICAL: `usedPreAggregations` is a HINT, not proof. Lambda rollups
 * (union_with_source_data) report an EMPTY array even when sealed partitions
 * serve, so an empty array on a rollup-backed shape is `unknown` ("lambda
 * ambiguous"), never a confident `miss`. Routing can only be PROVEN from the
 * compiled SQL FROM clause — out of scope here; the tri-state stays honest.
 *
 * The classifier itself is pure (no I/O). `buildRegistryView` is the thin impure
 * adapter that loads the model registry; the caller builds the view per game.
 */

import { getModelPreaggRegistry } from './preagg-model-registry.js';
import { SLOW_MS, type QueryShape } from './query-perf-store.js';

export type PreaggHit = 'hit' | 'miss' | 'unknown';
export type Matchability = 'matchable' | 'unmatchable' | 'partial';

export interface Verdict {
  preaggHit: PreaggHit;
  matchability: Matchability;
  reason: string;
}

/** Per-cube rollup facts the classifier needs. Keyed by cube name. */
export interface CubeRollupInfo {
  hasRollup: boolean;
  /** Qualified time-dimension members of candidate rollups on this cube. */
  timeDimensions: string[];
}
export type RegistryView = Record<string, CubeRollupInfo>;

/**
 * High-cardinality per-entity identifiers. A query grouping by one of these is a
 * row-listing, not an aggregate — no rollup can serve it. Tunable (not inlined)
 * so a game's bespoke id column can be added without touching logic.
 */
export const IDENTITY_DIMENSIONS = [
  'user_id', 'role_id', 'account_id', 'transaction_id',
  'transid', 'vng_transaction', 'openid', 'vopenid',
];

/** Non-additive measure name fragments (avg / exact count_distinct). */
const NON_ADDITIVE_FRAGMENTS = ['avg', 'average', 'mean', 'median'];

/** The trailing member segment, e.g. `mf_users.user_id` → `user_id`. */
function memberName(member: string): string {
  const i = member.lastIndexOf('.');
  return i >= 0 ? member.slice(i + 1) : member;
}

/** The cube, e.g. `mf_users.user_id` → `mf_users`. */
function cubeOf(member: string): string | null {
  const i = member.indexOf('.');
  return i > 0 ? member.slice(0, i) : null;
}

/** Is this dimension a high-cardinality per-entity identifier? */
export function isIdentifierDim(member: string): boolean {
  const name = memberName(member);
  return IDENTITY_DIMENSIONS.some((id) => name === id || name.endsWith(`_${id}`));
}

/** Is this measure non-additive (can't be summed across rollup partitions)? */
export function isNonAdditiveMeasure(member: string): boolean {
  const name = memberName(member).toLowerCase();
  if (NON_ADDITIVE_FRAGMENTS.some((f) => name.includes(f))) return true;
  // Exact count_distinct is non-additive; the *_approx variant is additive-safe.
  if (name.includes('distinct') && !name.includes('approx')) return true;
  return false;
}

/** The dominant cube of a shape = the cube most members reference. */
export function dominantCube(shape: QueryShape): string | null {
  const counts = new Map<string, number>();
  for (const m of [...shape.measures, ...shape.dimensions]) {
    const c = cubeOf(m);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) { best = c; bestN = n; }
  }
  return best;
}

/** Pure matchability: can a rollup EVER serve this shape? */
export function matchability(shape: QueryShape, view: RegistryView): { matchability: Matchability; reason: string } {
  const idDim = shape.dimensions.find(isIdentifierDim);
  if (idDim) {
    return { matchability: 'unmatchable', reason: `per-user dimension "${idDim}" → no aggregate rollup possible` };
  }
  const nonAdditive = shape.measures.filter(isNonAdditiveMeasure);
  if (nonAdditive.length) {
    return {
      matchability: 'partial',
      reason: `non-additive measure(s) ${nonAdditive.join(', ')} — remodel as sum+count or count_distinct_approx before rolling up`,
    };
  }
  const cube = dominantCube(shape);
  const info = cube ? view[cube] : undefined;
  if (!info || !info.hasRollup) {
    return { matchability: 'matchable', reason: 'additive shape, no rollup defined — a rollup could serve this' };
  }
  // A rollup exists — is it keyed on a time dim the query actually binds?
  const queryTimeDims = shape.dimensions.filter((d) => info.timeDimensions.includes(d));
  if (info.timeDimensions.length && queryTimeDims.length === 0) {
    return {
      matchability: 'matchable',
      reason: `time-dim mismatch: rollup keyed on ${info.timeDimensions.join('/')}, query binds none — add a sibling rollup on the query's time dim`,
    };
  }
  return { matchability: 'matchable', reason: 'additive shape with a matching rollup' };
}

/** Pure pre-agg-hit decision combining all signals. */
export function preaggHit(
  shape: QueryShape,
  usedPreaggs: string[],
  latencyMs: number,
  view: RegistryView,
  match: Matchability,
): { preaggHit: PreaggHit; reason: string } {
  if (usedPreaggs.length > 0) {
    return { preaggHit: 'hit', reason: `served by ${usedPreaggs.join(', ')}` };
  }
  if (match === 'unmatchable') {
    return { preaggHit: 'miss', reason: 'raw Trino read — shape cannot be rolled up' };
  }
  const cube = dominantCube(shape);
  const hasRollup = !!(cube && view[cube]?.hasRollup);
  if (hasRollup && latencyMs < SLOW_MS) {
    return { preaggHit: 'unknown', reason: 'lambda-ambiguous: empty usedPreAggregations but fast + rollup exists' };
  }
  if (hasRollup) {
    return { preaggHit: 'miss', reason: 'fell through to raw despite a candidate rollup' };
  }
  return { preaggHit: 'miss', reason: 'no rollup defined for this shape' };
}

/** Full verdict for one captured row. Pure. */
export function classifyQueryPerf(
  shape: QueryShape | null,
  usedPreaggs: string[],
  latencyMs: number,
  view: RegistryView,
): Verdict {
  if (!shape || (shape.measures.length === 0 && shape.dimensions.length === 0)) {
    return { preaggHit: 'unknown', matchability: 'matchable', reason: 'no query shape captured' };
  }
  const m = matchability(shape, view);
  const h = preaggHit(shape, usedPreaggs, latencyMs, view, m.matchability);
  return { preaggHit: h.preaggHit, matchability: m.matchability, reason: `${m.reason}; ${h.reason}` };
}

/**
 * Impure adapter: build a RegistryView for a game from the model registry.
 * Returns an empty view (every lookup misses) when the model isn't available
 * (e.g. prod containers without cube-dev) — the classifier degrades to
 * "no rollup defined" reasons rather than throwing.
 */
export function buildRegistryView(game: string | null): RegistryView {
  if (!game) return {};
  const entries = getModelPreaggRegistry(game);
  if (!entries) return {};
  const view: RegistryView = {};
  for (const e of entries) {
    const cur = view[e.cube] ?? { hasRollup: true, timeDimensions: [] };
    cur.hasRollup = true;
    if (e.timeDimension && !cur.timeDimensions.includes(e.timeDimension)) {
      cur.timeDimensions.push(e.timeDimension);
    }
    view[e.cube] = cur;
  }
  return view;
}
