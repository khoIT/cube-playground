/**
 * LTV-tiered member sampling. At segment-refresh time, ranks the cohort by a
 * per-user LTV measure and materializes three 50-member subgroups (top /
 * middle / bottom) so the Members tab can render representative samples — and
 * the member-360 precompute knows which 150 users to warm.
 *
 * Queries are scoped by the segment's PREDICATE filters (never an inlined
 * uid-IN list — see docs/lessons-learned.md "Scope cohort queries by
 * predicate"), ordered by the LTV measure with a secondary identity-dim order
 * so ties don't shuffle the middle-tier offset window between runs.
 *
 * Any failure returns null — tier sampling is an enhancement; it must never
 * break or delay-fail a refresh.
 */

import { loadWithContinueWait } from './load-with-continue-wait.js';
import { physicalizeQuery } from './cube-member-resolver.js';
import type { MemberTiers, TierMember, TierName } from '../types/segment.js';

/** Members per tier. 3 tiers × 50 = the 150-user sampling contract. */
export const TIER_SIZE = 50;

/** Per-tier-query Cube timeout — same ceiling as a preset card load. */
const PER_TIER_TIMEOUT_MS = 30_000;

// Filters carried opaquely from the segment's stored cube_query_json — may be
// leaves or nested and/or groups, already physical on prefix workspaces
// (physicalizeQuery is idempotent on them).
type TierFilter =
  | { member: string; operator: string; values?: string[] }
  | { and: TierFilter[] }
  | { or: TierFilter[] };

interface TierQuery {
  dimensions: string[];
  measures: string[];
  filters?: TierFilter[];
  /** Cube-level segments from the cohort definition (e.g. mf_users.whales). */
  segments?: string[];
  order: Record<string, 'asc' | 'desc'>;
  limit: number;
  offset?: number;
}

export interface ComputeMemberTiersArgs {
  /** Identity dimension as used for uid materialization (may be physical on
   *  prefix workspaces — consistent with the stored uid_list value space). */
  identityDim: string;
  /** Per-user LTV measure, logical name (physicalized here per `prefix`). */
  ltvMeasure: string;
  /** Optional per-user name dimension (e.g. mf_users.ingame_name), logical name.
   *  When set, each TierMember carries its in-game name so the Members tab can
   *  render the friendly identity without a view-time live query. The caller
   *  MUST pass null when the game's model doesn't expose the dim — an unknown
   *  member would 400 the whole tier query. Name is functionally 1:1 with the
   *  identity dim (one row per user), so grouping by it adds no fan-out. */
  nameDim?: string | null;
  /** The segment's predicate filters from its stored cube_query_json. */
  segmentFilters: TierFilter[];
  /** Cube-level segments from the same stored query — scope the ranking the
   *  same way membership is scoped, or tiers sample the wrong population. */
  cubeSegments?: string[];
  /** True cohort size from the refresh's `total: true` size query. */
  totalCount: number;
  tokenOverride?: string;
  /** Cube-name prefix for prefix-model workspaces; null on game_id workspaces. */
  prefix: string | null;
}

function extractRows(loadResult: unknown): Array<Record<string, unknown>> {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  return r.data ?? r.results?.[0]?.data ?? [];
}

/** Coerce a Cube measure cell (number, or numeric string from Trino) to a
 *  number; null when missing/unparseable so the FE renders "—" not NaN. */
function toLtv(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function computeMemberTiers(
  args: ComputeMemberTiersArgs,
): Promise<MemberTiers | null> {
  const { identityDim, ltvMeasure, nameDim, segmentFilters, cubeSegments, totalCount, tokenOverride, prefix } = args;
  if (totalCount <= 0) return null;

  // One row per user: group by the identity dim, aggregate the LTV measure.
  // Secondary order on the identity dim keeps tie ranks deterministic so the
  // middle tier's offset window is stable across runs. The name dim (when the
  // caller verified the game models it) rides along in the group-by — 1:1 with
  // the user, so it adds no fan-out — and is stored on each member.
  function buildQuery(direction: 'asc' | 'desc', limit: number, offset?: number): TierQuery {
    const q: TierQuery = {
      dimensions: nameDim ? [identityDim, nameDim] : [identityDim],
      measures: [ltvMeasure],
      order: { [ltvMeasure]: direction, [identityDim]: 'asc' },
      limit,
    };
    if (segmentFilters.length > 0) q.filters = segmentFilters;
    if (cubeSegments && cubeSegments.length > 0) q.segments = cubeSegments;
    if (offset && offset > 0) q.offset = offset;
    return q;
  }

  async function runTierQuery(query: TierQuery): Promise<TierMember[]> {
    // Physicalize for prefix workspaces, then read rows by the PHYSICAL keys
    // taken from the physicalized query itself — no logical/physical key
    // ambiguity regardless of what shape identityDim arrived in.
    const physical = physicalizeQuery(query, prefix);
    const dimKey = physical.dimensions[0];
    const nameKey = nameDim ? physical.dimensions[1] : null;
    const measureKey = physical.measures[0];
    const raw = await loadWithContinueWait(physical, tokenOverride, PER_TIER_TIMEOUT_MS);
    const members: TierMember[] = [];
    for (const row of extractRows(raw)) {
      const uid = row[dimKey];
      if (uid == null) continue;
      const member: TierMember = { uid: String(uid), ltv: toLtv(row[measureKey]) };
      if (nameKey) {
        const name = row[nameKey];
        if (name != null && String(name).trim() !== '') member.name = String(name);
      }
      members.push(member);
    }
    return members;
  }

  try {
    const tiers: Partial<Record<TierName, TierMember[]>> = {};

    if (totalCount <= TIER_SIZE * 3) {
      // Degenerate cohort: everyone fits in one ranked list — no offset games.
      const all = await runTierQuery(buildQuery('desc', Math.min(totalCount, TIER_SIZE * 3)));
      if (all.length === 0) return null; // transient empty result — never cache it
      tiers.all = all;
    } else {
      const middleOffset = Math.max(0, Math.floor(totalCount / 2) - Math.floor(TIER_SIZE / 2));
      const [top, bottom, middle] = [
        await runTierQuery(buildQuery('desc', TIER_SIZE)),
        await runTierQuery(buildQuery('asc', TIER_SIZE)),
        await runTierQuery(buildQuery('desc', TIER_SIZE, middleOffset)),
      ];
      if (top.length === 0 && bottom.length === 0 && middle.length === 0) return null;

      // Ranks can't overlap for cohorts >150, but LTV ties at window edges can
      // surface the same uid in two windows. Dedupe by priority
      // top > bottom > middle (drop the dupe from the lower-priority tier).
      const seen = new Set(top.map((m) => m.uid));
      tiers.top = top;
      tiers.bottom = bottom.filter((m) => !seen.has(m.uid));
      for (const m of tiers.bottom) seen.add(m.uid);
      tiers.middle = middle.filter((m) => !seen.has(m.uid));
    }

    return {
      computed_at: new Date().toISOString(),
      ltv_measure: ltvMeasure,
      tiers,
    };
  } catch (err) {
    // Enhancement-only: log and bail. The refresh continues; the previous
    // tiers (if any) stay in place with their visible computed_at staleness.
    console.warn('[member-tier-runner] tier computation failed:', (err as Error).message);
    return null;
  }
}
