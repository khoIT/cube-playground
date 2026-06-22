/**
 * Typed client for the live "paying users only" Members tiers
 * (GET /api/segments/:id/member-tiers?scope=paying). The default ("all") tiers
 * ship inline on the segment detail payload (segment.member_tiers); this route
 * serves ONLY the paying sub-cohort, recomputed live (never precomputed).
 *
 * Returns `null` when the sub-scope doesn't apply (non-mf_users hub) or no rank
 * measure resolves — the caller then shows a "paying tiers unavailable" note.
 */

import { apiFetch } from './api-client';
import type { MemberTiers } from '../types/segment-api';

interface PayingTiersResponse {
  tiers: MemberTiers | null;
}

export function fetchPayingMemberTiers(id: string): Promise<MemberTiers | null> {
  return apiFetch<PayingTiersResponse>(
    `/api/segments/${encodeURIComponent(id)}/member-tiers?scope=paying`,
  ).then((r) => r.tiers);
}
