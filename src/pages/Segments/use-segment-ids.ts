/**
 * Shared module-level cache of the server's segments list, exposed two ways:
 *
 *   - `useSegmentRows()` — full rows, used by the sidebar to surface segments
 *     shared by teammates (visibility shared/org, owner ≠ viewer).
 *   - `useSegmentIds()` — derived id set, used by the sidebar recents tray to
 *     hide entries whose segment no longer exists (deleted in another tab,
 *     removed via API, etc.).
 *
 * Both hooks share ONE fetch (single-flight, mirrors `useBusinessMetrics`)
 * so the sidebar render path costs at most one network request per session;
 * mutating sites call `invalidateSegmentIds()` to drop the cache so the next
 * subscriber re-fetches.
 */

import { useEffect, useMemo, useState } from 'react';

import { segmentsClient } from '../../api/segments-client';
import type { Segment } from '../../types/segment-api';

const INVALIDATE_EVENT = 'gds-cube:segments-changed';

let cache: Segment[] | null = null;
let inflight: Promise<Segment[]> | null = null;

async function fetchOnce(): Promise<Segment[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // owner=* — recents may reference segments owned by other users in the
      // dev-pretend-auth model, and the shared group needs teammates' rows.
      cache = await segmentsClient.list({ owner: '*' });
      return cache;
    } catch {
      cache = [];
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateSegmentIds(): void {
  cache = null;
  inflight = null;
  try {
    window.dispatchEvent(new Event(INVALIDATE_EVENT));
  } catch {
    /* noop */
  }
}

interface UseSegmentRowsResult {
  rows: Segment[] | null;
  loading: boolean;
}

export function useSegmentRows(): UseSegmentRowsResult {
  const [rows, setRows] = useState<Segment[] | null>(cache);
  const [loading, setLoading] = useState<boolean>(cache === null);

  useEffect(() => {
    let cancelled = false;
    function load(): void {
      if (cache !== null) {
        setRows(cache);
        setLoading(false);
        return;
      }
      setLoading(true);
      fetchOnce().then((list) => {
        if (cancelled) return;
        setRows(list);
        setLoading(false);
      });
    }
    load();
    const handler = (): void => load();
    window.addEventListener(INVALIDATE_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(INVALIDATE_EVENT, handler);
    };
  }, []);

  return { rows, loading };
}

interface UseSegmentIdsResult {
  ids: Set<string> | null;
  loading: boolean;
}

export function useSegmentIds(): UseSegmentIdsResult {
  const { rows, loading } = useSegmentRows();
  const ids = useMemo(() => (rows ? new Set(rows.map((s) => s.id)) : null), [rows]);
  return { ids, loading };
}

/**
 * Narrow rows to one game's segments. Segments belong to a game — list
 * surfaces (sidebar recents/pills, pickers) show only the active game's rows;
 * switching back restores the others (the underlying fetch stays unscoped so
 * the single-flight cache survives game changes without a refetch).
 * Null passes through: "still loading" must stay distinguishable from "empty"
 * so consumers' pass-through-while-loading guards keep working.
 */
export function filterRowsByGame(rows: Segment[] | null, gameId: string): Segment[] | null {
  if (!rows) return null;
  return rows.filter((s) => s.game_id === gameId);
}

/**
 * Segments shared WITH the viewer: visibility shared/org and owned by someone
 * else. The viewer's own shared segments are excluded — the pill marks
 * "shared with me", not "shared by me" (those live in normal recents).
 */
export function selectSharedSegments(rows: Segment[] | null, cap: number): Segment[] {
  if (!rows) return [];
  return rows
    // Keyed off LITERAL is_owner, never can_administer — admins administer
    // every org segment, and the wider flag would empty this rail for them.
    .filter((s) => (s.visibility === 'shared' || s.visibility === 'org') && !s.is_owner)
    .slice(0, cap);
}

/** Test-only: reset module state between cases. */
export function __resetSegmentIdsCache(): void {
  cache = null;
  inflight = null;
}
