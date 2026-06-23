/**
 * Runs a delta decomposition for the given request and tracks loading/error.
 * Aborts the in-flight request when inputs change or the component unmounts.
 */
import { useEffect, useState } from 'react';
import {
  postDeltaDecompose,
  type DeltaDecomposeRequest,
  type DeltaDecomposeResult,
} from './decompose-api';

export interface DeltaDecompositionState {
  data: DeltaDecomposeResult | null;
  loading: boolean;
  error: string | null;
}

export function useDeltaDecomposition(req: DeltaDecomposeRequest | null): DeltaDecompositionState {
  const [state, setState] = useState<DeltaDecompositionState>({
    data: null,
    loading: false,
    error: null,
  });

  // Serialize the request so the effect re-runs only on a real input change.
  const key = req ? JSON.stringify(req) : null;

  useEffect(() => {
    if (!req || !key) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    postDeltaDecompose(req, ctl.signal)
      .then((data) => {
        if (ctl.signal.aborted) return;
        setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
