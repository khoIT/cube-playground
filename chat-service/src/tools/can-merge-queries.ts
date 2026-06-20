/**
 * can-merge-queries — decide whether two Cube queries can be aligned into a
 * single dual-axis chart (one date axis, two measures on independent y-axes).
 *
 * Two cross-cube queries cannot be joined in one Cube /load (the semantic layer
 * is single-cube scoped and these cubes share no join). The only correct way to
 * overlay them is to load each independently and align the rows on the shared
 * DATE VALUE. That alignment is only meaningful when both queries describe the
 * same daily/weekly/… axis over the same window and plot DIFFERENT measures —
 * this guard enforces exactly that pre-condition.
 *
 * The guard is necessary but not sufficient: two queries with a RELATIVE range
 * can still resolve to different windows if their cubes have different data
 * freshness. That divergence can only be seen after loading, so the caller does
 * a second snapped-range comparison post-load (see emit-combined-artifact).
 */

import { normalizeCubeDateRanges } from './normalize-cube-date-range.js';
import type { CubeQuery, TimeDimension } from '../types.js';

/** Why a pair was rejected — surfaced to the caller for the two-card fallback. */
export type MergeRejectReason =
  | 'no_time_dim' // a query has zero time dimensions carrying a range
  | 'multiple_time_dims' // a query has >1 time dimension (ambiguous date axis)
  | 'granularity_mismatch' // the two date axes are at different grains
  | 'range_mismatch' // the two date windows differ (after normalization)
  | 'no_measures' // a query has no measure to plot
  | 'measure_overlap'; // the two queries share a measure (nothing to contrast)

export type CanMergeResult =
  | { ok: true }
  | { ok: false; reason: MergeRejectReason; detail: string };

/** The single range-bearing time dimension, or a typed reason it can't be one. */
function soleTimeDim(
  query: CubeQuery,
): { td: TimeDimension } | { reason: 'no_time_dim' | 'multiple_time_dims' } {
  const withRange = (query.timeDimensions ?? []).filter((t) => t.dateRange !== undefined);
  if (withRange.length === 0) return { reason: 'no_time_dim' };
  if (withRange.length > 1) return { reason: 'multiple_time_dims' };
  return { td: withRange[0] };
}

/** Normalize a relative phrase to a concrete tuple so equal windows compare equal. */
function normalizedRangeKey(td: TimeDimension): string {
  const [norm] = normalizeCubeDateRanges([td]) ?? [];
  return JSON.stringify(norm?.dateRange ?? null);
}

/**
 * Can `primary` and `overlay` be overlaid on one date axis? Requires: each has
 * exactly one range-bearing time dimension, the two share the same granularity
 * and (normalized) date window, each plots at least one measure, and the two
 * measure sets are disjoint.
 */
export function canMerge(primary: CubeQuery, overlay: CubeQuery): CanMergeResult {
  const pTd = soleTimeDim(primary);
  if ('reason' in pTd) return reject(pTd.reason, `primary query: ${pTd.reason}`);
  const oTd = soleTimeDim(overlay);
  if ('reason' in oTd) return reject(oTd.reason, `overlay query: ${oTd.reason}`);

  if ((pTd.td.granularity ?? 'day') !== (oTd.td.granularity ?? 'day')) {
    return reject(
      'granularity_mismatch',
      `primary grain '${pTd.td.granularity}' != overlay grain '${oTd.td.granularity}'`,
    );
  }

  if (normalizedRangeKey(pTd.td) !== normalizedRangeKey(oTd.td)) {
    return reject('range_mismatch', 'the two date windows resolve to different ranges');
  }

  const pMeasures = primary.measures ?? [];
  const oMeasures = overlay.measures ?? [];
  if (pMeasures.length === 0 || oMeasures.length === 0) {
    return reject('no_measures', 'each query must plot at least one measure');
  }

  const overlap = pMeasures.filter((m) => oMeasures.includes(m));
  if (overlap.length > 0) {
    return reject('measure_overlap', `shared measure(s): ${overlap.join(', ')}`);
  }

  return { ok: true };
}

function reject(reason: MergeRejectReason, detail: string): CanMergeResult {
  return { ok: false, reason, detail };
}
