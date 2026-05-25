/**
 * sessionStorage cache for Live KPI tiles.
 * Key: `liveops:kpi:<gameId>` — scoped per game so no cross-game leak.
 * TTL: 5 minutes.
 */

import type { KpiTileData } from './use-live-kpis-types';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY_PREFIX = 'liveops:kpi:';

export interface CacheEntry {
  tiles: KpiTileData[];
  fetchedAt: number;
}

export function readCache(gameId: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY_PREFIX + gameId);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

export function writeCache(gameId: string, tiles: KpiTileData[]): void {
  try {
    const entry: CacheEntry = { tiles, fetchedAt: Date.now() };
    sessionStorage.setItem(CACHE_KEY_PREFIX + gameId, JSON.stringify(entry));
  } catch {
    // sessionStorage may be unavailable in some contexts — silently ignore.
  }
}
