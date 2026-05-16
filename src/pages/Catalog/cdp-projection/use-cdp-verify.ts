/**
 * useCdpVerify — drives the verify state machine for a single projected
 * measure. `runIdRef` keeps the latest invocation authoritative when the
 * user double-clicks Verify; stale resolves are dropped silently.
 */

import { useRef, useState, useCallback } from 'react';
import type { CdpMetricPayload, VerifyState } from './types';
import { getMetric } from './api';
import { diffEquality } from './diff-equality';

export interface UseCdpVerifyResult {
  state: VerifyState;
  check: () => Promise<void>;
}

export function useCdpVerify(payload: CdpMetricPayload): UseCdpVerifyResult {
  const [state, setState] = useState<VerifyState>({ kind: 'idle' });
  const runIdRef = useRef(0);

  const check = useCallback(async () => {
    const myRun = ++runIdRef.current;
    setState({ kind: 'checking' });

    const result = await getMetric(payload.game_id, payload.metric_name);
    if (myRun !== runIdRef.current) return;

    if (result.ok) {
      const diff = diffEquality(payload, result.data as unknown as Record<string, unknown>);
      if (diff.length === 0) {
        setState({ kind: 'available' });
      } else {
        setState({ kind: 'mismatch', diff });
      }
      return;
    }

    if (result.status === 404) {
      setState({ kind: 'missing' });
      return;
    }

    setState({ kind: 'error', message: result.reason });
  }, [payload.game_id, payload.metric_name, payload]);

  return { state, check };
}
