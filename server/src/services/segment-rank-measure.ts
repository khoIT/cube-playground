/**
 * Pick the measure a segment's members should be RANKED by: the metric the
 * segment was defined on when its predicate filters one (e.g. a "30d spend ≥
 * 5M" cohort ranks by that spend measure), otherwise the preset's generic
 * per-user LTV measure. Consumed by both the tier sampler and the ranked
 * member-profile runner so the Members tab and the pull API agree on order.
 */

import { physicalMember } from './cube-member-resolver.js';
import type { MetaMemberSets } from './cube-meta-members.js';

// Same opaque filter shape the tier runner carries from cube_query_json.
export type RankFilter =
  | { member: string; operator: string; values?: string[] }
  | { and: RankFilter[] }
  | { or: RankFilter[] };

/** Filter leaf members in document order — the author's priority order. */
function leafMembers(filters: RankFilter[], out: string[] = []): string[] {
  for (const f of filters) {
    if ('member' in f && typeof f.member === 'string') out.push(f.member);
    else if ('and' in f && Array.isArray(f.and)) leafMembers(f.and, out);
    else if ('or' in f && Array.isArray(f.or)) leafMembers(f.or, out);
  }
  return out;
}

/**
 * First filter leaf that /meta says is a measure wins (the segment's defining
 * metric); fall back to the preset LTV measure. Without meta (Cube
 * unreachable) we can't tell measures from dimensions, so the fallback is
 * used — the prior behavior, never a guess.
 *
 * Returned in the same (possibly physical) member space the filters are
 * stored in; downstream physicalization is idempotent on it.
 */
export function pickSegmentRankMeasure(
  filters: RankFilter[],
  metaSets: MetaMemberSets | null,
  prefix: string | null,
  fallbackLtvMeasure: string | null,
): string | null {
  if (metaSets) {
    for (const member of leafMembers(filters)) {
      if (metaSets.measures.has(physicalMember(member, prefix))) return member;
    }
  }
  return fallbackLtvMeasure;
}
