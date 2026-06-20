/**
 * Fetch hook for the two-segment overlap counts. Loads once per (a, b) pair,
 * aborts in-flight requests on unmount / id change, and surfaces a typed error
 * (e.g. CROSS_GAME, NO_SNAPSHOT_SCHEMA) for the page to render.
 */

import { useEffect, useState } from 'react';
import { segmentCompareClient, type OverlapResponse } from '../../../api/segment-compare-client';
import { SegmentApiError } from '../../../api/api-client';

export interface OverlapState {
  data: OverlapResponse | null;
  loading: boolean;
  error: { code: string; message: string } | null;
}

export function useSegmentOverlap(a: string | null, b: string | null): OverlapState {
  const [state, setState] = useState<OverlapState>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!a || !b) {
      setState({ data: null, loading: false, error: { code: 'MISSING_IDS', message: 'Pick two segments to compare.' } });
      return;
    }
    const ctl = new AbortController();
    setState({ data: null, loading: true, error: null });
    segmentCompareClient
      .overlap(a, b, ctl.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        const e =
          err instanceof SegmentApiError
            ? { code: err.code, message: err.message }
            : { code: 'UNKNOWN', message: String(err) };
        setState({ data: null, loading: false, error: e });
      });
    return () => ctl.abort();
  }, [a, b]);

  return state;
}
