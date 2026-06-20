/**
 * Per-region metric aggregates for the segment-compare surface.
 *
 * Given a region's uid set (A-only / both / B-only, resolved server-side from
 * the membership snapshot), compute avg + median of each catalogued segmentable
 * measure over those members. The aggregate is EXACT: every member's per-user
 * dimension value is read in one identity-IN Cube query and reduced app-side.
 *
 * Cube inlines an identity-IN list into the query text, which it rejects past a
 * length ceiling — the same limit the on-demand member-profile path lives under.
 * So a region larger than the cap is sampled (first N by uid order) and the
 * result is flagged `sampled` with the sample size, rather than failing or
 * silently scanning a partial set. Exact for regions within the cap; an honest,
 * disclosed approximation above it.
 */

import { loadWithContinueWait } from './load-with-continue-wait.js';
import { physicalizeQuery, physicalMember } from './cube-member-resolver.js';
import { getSegmentableMeasures } from './segmentable-measures-catalog.js';
import { resolveIdentityField } from './resolve-identity-field.js';
import { resolveGamePrefixForWorkspace } from './resolve-game-prefix.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';

/** Identity-IN ceiling — at/under this the region aggregate is exact. */
export const REGION_METRIC_UID_CAP =
  Number(process.env.REGION_METRIC_UID_CAP) || 1000;

const REGION_METRIC_TIMEOUT_MS =
  Number(process.env.REGION_METRIC_TIMEOUT_MS) || 120_000;

export interface RegionMeasureStat {
  concept: string;
  label: string;
  currency: 'vnd' | 'usd' | null;
  /** Mean over members with a non-null value; null when none. */
  avg: number | null;
  /** Median over members with a non-null value; null when none. */
  median: number | null;
  /** Members contributing a non-null value to this measure. */
  count: number;
}

export interface RegionMetricsResult {
  /** Members the aggregate ran over (= memberCount unless sampled). */
  sampleSize: number;
  /** True when the region exceeded the cap and was sampled. */
  sampled: boolean;
  measures: RegionMeasureStat[];
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function extractRows(loadResult: unknown): Array<Record<string, unknown>> {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  return r.data ?? r.results?.[0]?.data ?? [];
}

/**
 * Compute avg + median for every catalogued measure of `game` over `uids`.
 * Returns null when the game has no catalogued measures or the cube has no
 * identity mapping (caller renders an empty/unavailable state).
 */
export async function computeRegionMetrics(opts: {
  gameId: string;
  cube: string;
  workspace: string;
  uids: string[];
}): Promise<RegionMetricsResult | null> {
  const measures = getSegmentableMeasures(opts.gameId);
  if (measures.length === 0 || opts.uids.length === 0) return null;

  const identityDim = await resolveIdentityField(opts.cube, opts.gameId, {
    workspaceId: opts.workspace,
  });
  if (!identityDim) return null;

  const sampled = opts.uids.length > REGION_METRIC_UID_CAP;
  const scopedUids = sampled ? opts.uids.slice(0, REGION_METRIC_UID_CAP) : opts.uids;

  const prefix = resolveGamePrefixForWorkspace(opts.workspace, opts.gameId);
  const token = resolveCubeTokenForGame(opts.gameId) ?? undefined;

  // One row per member carrying the identity + every measure's per-user
  // dimension; reduced to avg/median per measure below.
  const measureDims = measures.map((m) => m.dimension);
  const query = {
    dimensions: [identityDim, ...measureDims],
    measures: [],
    filters: [{ member: identityDim, operator: 'equals', values: scopedUids }],
    limit: scopedUids.length,
  };

  const physical = physicalizeQuery(query, prefix);
  const raw = await loadWithContinueWait(physical, token, REGION_METRIC_TIMEOUT_MS);
  const rows = extractRows(raw);

  const stats: RegionMeasureStat[] = measures.map((m) => {
    const key = physicalMember(m.dimension, prefix);
    const values: number[] = [];
    for (const row of rows) {
      const v = Number(row[key]);
      if (Number.isFinite(v)) values.push(v);
    }
    values.sort((x, y) => x - y);
    const sum = values.reduce((acc, v) => acc + v, 0);
    return {
      concept: m.concept,
      label: m.label,
      currency: m.currency,
      avg: values.length ? sum / values.length : null,
      median: median(values),
      count: values.length,
    };
  });

  return { sampleSize: scopedUids.length, sampled, measures: stats };
}
