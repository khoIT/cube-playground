/**
 * Generic loader for a Movement-tab resource: tracks loading/error/data, cancels
 * stale responses on dependency change, and never throws (the read endpoints
 * serve stale on upstream error; a hard 502 surfaces as `error`).
 */

import { useEffect, useState } from 'react';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useMovementResource<T>(
  loader: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (alive) setState({ data: null, loading: false, error: err });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
