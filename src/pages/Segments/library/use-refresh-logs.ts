/**
 * Bulk-fetch refresh-log rows for a list of segment ids. Avoids N+1 by
 * calling POST /api/segments/refresh-logs once per visible-id set.
 */

import { useEffect, useState } from 'react';
import { segmentsClient } from '../../../api/segments-client';
import type { RefreshLogRow } from '../../../types/segment-api';

export function useRefreshLogs(ids: string[], days = 7) {
  const [logs, setLogs] = useState<Record<string, RefreshLogRow[]>>({});

  // Stable key — avoid refetch when caller passes a new array with the same ids.
  const key = ids.slice().sort().join(',');

  useEffect(() => {
    if (ids.length === 0) {
      setLogs({});
      return;
    }
    let cancelled = false;
    segmentsClient
      .refreshLogs(ids, days)
      .then((res) => {
        if (!cancelled) setLogs(res);
      })
      .catch(() => {
        // Sparklines fail-soft: show '—' on error.
        if (!cancelled) setLogs({});
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, days]);

  return logs;
}
