/**
 * Computes a "vs N days ago" size delta for a segment using its refresh log.
 *
 * Looks back through the log for the oldest entry within the requested window;
 * returns the previous uid_count and the percent change (current minus prev /
 * prev * 100). Returns null when the log is too short to compare.
 */

import { useEffect, useState } from 'react';
import { segmentsClient } from '../../../../api/segments-client';
import type { RefreshLogRow } from '../../../../types/segment-api';

export interface SegmentSizeDelta {
  loading: boolean;
  previous: number | null;
  /** Percent change vs `previous` (positive = grew). null when not computable. */
  percent: number | null;
  /** Days the comparison reaches back. Used for the "vs last week" label. */
  windowDays: number;
  /** Raw refresh log rows used to compute the delta. Newest → oldest. */
  rows: RefreshLogRow[];
}

export function useSegmentSizeDelta(
  segmentId: string | null,
  currentCount: number | null,
  windowDays = 7,
): SegmentSizeDelta {
  const [previous, setPrevious] = useState<number | null>(null);
  const [rows, setRows] = useState<RefreshLogRow[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(segmentId));

  useEffect(() => {
    if (!segmentId) {
      setPrevious(null);
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    segmentsClient
      .refreshLog(segmentId, windowDays, 200)
      .then((fetched: RefreshLogRow[]) => {
        if (cancelled) return;
        setRows(fetched);
        const succeeded = fetched.filter(
          (r) => r.status !== 'broken' && typeof r.uid_count === 'number',
        );
        // Oldest successful refresh within the window — that's "what it was N days ago".
        const oldest = succeeded[succeeded.length - 1];
        setPrevious(oldest ? oldest.uid_count : null);
      })
      .catch(() => {
        if (cancelled) return;
        setPrevious(null);
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [segmentId, windowDays]);

  const percent = computePercent(currentCount, previous);
  return { loading, previous, percent, windowDays, rows };
}

function computePercent(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
