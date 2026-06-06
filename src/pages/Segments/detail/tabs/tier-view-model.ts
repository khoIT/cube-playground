/**
 * Pure view-model logic for the LTV-tiered Members view: tier option
 * derivation, uid→LTV lookup, and full-uid-list search. Kept free of React so
 * the tier semantics are unit-testable without rendering.
 */

import type { MemberTiers, TierMember, TierName } from '../../../../types/segment-api';

/** Display order. `all` only appears for degenerate cohorts (≤150 members)
 *  and is mutually exclusive with the trio server-side. */
export const TIER_ORDER: readonly TierName[] = ['top', 'middle', 'bottom', 'all'];

export interface TierOption {
  name: TierName;
  count: number;
}

/** Tiers that actually have members, in display order. Empty array means the
 *  payload is unusable → caller falls back to the random sample. */
export function tierOptions(tiers: MemberTiers): TierOption[] {
  const out: TierOption[] = [];
  for (const name of TIER_ORDER) {
    const members = tiers.tiers[name];
    if (Array.isArray(members) && members.length > 0) {
      out.push({ name, count: members.length });
    }
  }
  return out;
}

/** uid → LTV across every tier, for annotating search results with known
 *  values (uids outside the 150-sample have no stored LTV → null). */
export function buildLtvByUid(tiers: MemberTiers): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const name of TIER_ORDER) {
    for (const member of tiers.tiers[name] ?? []) {
      m.set(member.uid, member.ltv);
    }
  }
  return m;
}

/** Substring search across the FULL uid list (not just the 150-sample) — the
 *  same contract as the legacy sample view. LTV attached when known. */
export function searchPool(
  uidList: readonly string[],
  ltvByUid: Map<string, number | null>,
  rawNeedle: string,
): TierMember[] {
  const needle = rawNeedle.trim().toLowerCase();
  const matched = needle
    ? uidList.filter((uid) => uid.toLowerCase().includes(needle))
    : [...uidList];
  return matched.map((uid) => ({ uid, ltv: ltvByUid.get(uid) ?? null }));
}
