/**
 * Polls /api/segments/:id every N seconds while the Detail view is mounted.
 * Pauses when document.hidden; resumes on visibility return. Caller is
 * responsible for merging fresh rows into local state.
 */

import { useEffect, useRef } from 'react';
import { segmentsClient } from '../../../../api/segments-client';
import type { Segment } from '../../../../types/segment-api';

const DEFAULT_INTERVAL_MS = 30_000;

interface Options {
  intervalMs?: number;
  /** Skip polling for static segments. */
  enabled?: boolean;
}

export function useSegmentLivePolling(
  segmentId: string | null,
  onUpdate: (seg: Segment) => void,
  options: Options = {},
): void {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;
  const handleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!segmentId || !enabled) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const seg = await segmentsClient.get(segmentId);
        if (!cancelled) onUpdateRef.current(seg);
      } catch {
        // swallow — next tick retries
      }
    };

    handleRef.current = setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      if (handleRef.current) clearInterval(handleRef.current);
      handleRef.current = null;
    };
  }, [segmentId, enabled, intervalMs]);
}
