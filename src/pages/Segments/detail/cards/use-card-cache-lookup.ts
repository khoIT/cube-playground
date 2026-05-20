/**
 * Helper to read a card's pre-rendered rows from segment.card_cache.
 * Keys match the server-side card-runner: `kpi:<id>`, `card:<tabId>:<id>`,
 * or `kpi:<tabId>:<id>` for tab-scoped KPIs.
 */

import type { Segment } from '../../../../types/segment-api';

/** Skip background refetch if the cache is younger than this. Long-ish because
 *  cron + manual refresh already keep the cache moving — re-firing 30 Cube
 *  queries on every tab open just to compare floods Cube and pegs the UI. */
const FRESH_FOR_MS = 15 * 60 * 1000;

export function getCachedRows(
  segment: Segment,
  cardKey: string,
): Array<Record<string, unknown>> | undefined {
  return segment.card_cache?.[cardKey]?.rows;
}

export function isCacheFresh(segment: Segment, cardKey: string): boolean {
  const fetchedAt = segment.card_cache?.[cardKey]?.fetched_at;
  if (!fetchedAt) return false;
  return Date.now() - new Date(fetchedAt).getTime() < FRESH_FOR_MS;
}
