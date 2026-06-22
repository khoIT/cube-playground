/**
 * Live "paying users only" Members tiers. The stored member_tiers snapshot
 * (refresh-segment.ts) ranks the FULL cohort; there is no paying-only tier set,
 * and the uid_list snapshot carries no per-uid LTV — so paying tiers can't be
 * derived from storage. This recomputes top/middle/bottom-50 on demand against
 * the payer sub-cohort by ANDing `paying_lifetime` onto the cohort segments and
 * sizing the offset windows off the PAYER total (not the full-segment total),
 * reusing the exact same ranked-tier engine as the refresh job (correctness by
 * construction — same query shape, dedup, name-dim handling).
 *
 * Returns null when the sub-scope doesn't apply (non-mf_users hub) or no rank
 * measure resolves — the FE then shows a "paying tiers unavailable" note rather
 * than a misleading full-segment view.
 */

import { computeMemberTiers } from './member-tier-runner.js';
import { resolvePayingCohortContext, countPayingCohort } from './segment-cohort-context.js';
import type { MemberTiers } from '../types/segment.js';
import type { SegmentRow } from '../routes/segments.js';

export async function computePayingMemberTiers(row: SegmentRow): Promise<MemberTiers | null> {
  const ctx = await resolvePayingCohortContext(row);
  if (!ctx || !ctx.rankMeasure) return null;

  const payerTotal = await countPayingCohort(ctx);
  if (payerTotal <= 0) {
    // No payers in the cohort: a valid, non-degenerate empty result. Return an
    // empty tier block (computed_at fresh) so the FE renders "0 paying members"
    // rather than falling back to the full-segment snapshot.
    return { computed_at: new Date().toISOString(), ltv_measure: ctx.rankMeasure, tiers: {} };
  }

  return computeMemberTiers({
    identityDim: ctx.identityField,
    ltvMeasure: ctx.rankMeasure,
    nameDim: ctx.nameDim,
    segmentFilters: ctx.segmentFilters,
    cubeSegments: ctx.payingCubeSegments,
    totalCount: payerTotal,
    tokenOverride: ctx.token,
    prefix: ctx.prefix,
  });
}
