/**
 * Cached panel source for the member-360 page — ONE fetch of the nightly
 * precompute's panel map per (segment, uid) mount, exposed as a synchronous
 * lookup the page consults before firing any live Cube query.
 *
 * Freshness contract: a cached panel older than 36h (24h nightly cadence +
 * 12h grace) or with status='error' is treated as a miss — the caller falls
 * back to the existing live path, which stays byte-for-byte unchanged. A
 * fetch failure degrades to "nothing cached" (live everywhere), never an
 * error surface of its own.
 *
 * `ready` gates the live fallback: consumers hold their live query idle until
 * the (fast, local-API) cache lookup resolves, so a cache hit never issues a
 * redundant Cube query — the no-double-fetch contract.
 */

import { useEffect, useMemo, useState } from 'react';
import { segmentsClient, type CachedMemberPanel } from '../../../api/segments-client';

/** 24h nightly cadence + 12h grace; older cache = miss (live fallback). */
export const CACHE_MAX_AGE_MS = 36 * 3600_000;

export interface CachedPanelHit {
  rows: Array<Record<string, unknown>>;
  fetchedAt: string;
}

export interface CachedPanelSource {
  /** True once the cache lookup settled (hit, miss, or fetch failure). */
  ready: boolean;
  /** Fresh ok rows for a panel, or null (miss/stale/error → go live). */
  getCached(panelId: string): CachedPanelHit | null;
}

export function isFreshCachedPanel(
  panel: CachedMemberPanel | undefined,
  now: number = Date.now(),
): panel is CachedMemberPanel {
  if (!panel || panel.status !== 'ok') return false;
  const fetched = Date.parse(panel.fetched_at);
  return Number.isFinite(fetched) && now - fetched <= CACHE_MAX_AGE_MS;
}

export function useCachedPanelSource(
  segmentId: string | undefined,
  uid: string | undefined,
): CachedPanelSource {
  const [state, setState] = useState<{
    key: string;
    panels: Record<string, CachedMemberPanel>;
  } | null>(null);

  const key = `${segmentId ?? ''}|${uid ?? ''}`;

  useEffect(() => {
    if (!segmentId || !uid) {
      setState({ key, panels: {} });
      return;
    }
    let cancelled = false;
    setState(null); // back to not-ready while the new member's map loads
    segmentsClient
      .memberPanels(segmentId, uid)
      .then((res) => {
        if (!cancelled) setState({ key, panels: res.panels ?? {} });
      })
      .catch(() => {
        // Cache endpoint unavailable → everything live, exactly like today.
        if (!cancelled) setState({ key, panels: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [segmentId, uid, key]);

  return useMemo<CachedPanelSource>(() => {
    const ready = state?.key === key;
    const panels = ready ? state!.panels : {};
    return {
      ready,
      getCached(panelId: string): CachedPanelHit | null {
        const panel = panels[panelId];
        if (!isFreshCachedPanel(panel)) return null;
        return { rows: panel.rows, fetchedAt: panel.fetched_at };
      },
    };
  }, [state, key]);
}
