/**
 * Helper to read a card's pre-rendered rows from segment.card_cache.
 * Keys match the server-side card-runner: `kpi:<id>`, `card:<tabId>:<id>`,
 * or `kpi:<tabId>:<id>` for tab-scoped KPIs.
 */

import type { Segment } from '../../../../types/segment-api';

export function getCachedRows(
  segment: Segment,
  cardKey: string,
): Array<Record<string, unknown>> | undefined {
  return segment.card_cache?.[cardKey]?.rows;
}

export function getCachedFetchedAt(
  segment: Segment,
  cardKey: string,
): string | undefined {
  return segment.card_cache?.[cardKey]?.fetched_at;
}
