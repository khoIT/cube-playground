/**
 * `useSegmentIds` — module-level cache of the server's segment-id set.
 *
 * Used by the sidebar recents tray to hide entries whose segment no longer
 * exists (deleted in another tab, removed via API, etc.). Single-flight
 * pattern mirrors `useBusinessMetrics` so the list is fetched at most once
 * per session; mutating sites call `invalidateSegmentIds()` to drop the
 * cache so the next subscriber re-fetches.
 */

import { useEffect, useState } from 'react';

import { segmentsClient } from '../../api/segments-client';

const INVALIDATE_EVENT = 'gds-cube:segments-changed';

let cache: Set<string> | null = null;
let inflight: Promise<Set<string>> | null = null;

async function fetchOnce(): Promise<Set<string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // owner=* — recents may reference segments owned by other users in the
      // dev-pretend-auth model; we only need the id set, not write access.
      const list = await segmentsClient.list({ owner: '*' });
      cache = new Set(list.map((s) => s.id));
      return cache;
    } catch {
      cache = new Set();
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

interface UseSegmentIdsResult {
  ids: Set<string> | null;
  loading: boolean;
}

export function useSegmentIds(): UseSegmentIdsResult {
  const [ids, setIds] = useState<Set<string> | null>(cache);
  const [loading, setLoading] = useState<boolean>(cache === null);

  useEffect(() => {
    let cancelled = false;
    function load(): void {
      if (cache !== null) {
        setIds(cache);
        setLoading(false);
        return;
      }
      setLoading(true);
      fetchOnce().then((s) => {
        if (cancelled) return;
        setIds(s);
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

  return { ids, loading };
}

/** Test-only: reset module state between cases. */
export function __resetSegmentIdsCache(): void {
  cache = null;
  inflight = null;
}
