/**
 * use-care-data-freshness — fetches `cube → YYYY-MM-DD` for the active game so
 * the CS Monitor can stamp each playbook row and the header with the freshest
 * date its data source actually holds.
 *
 * Deliberately separate from use-care-playbooks: a cold MAX probe on a heavy
 * as-of-anchored mart can take several seconds, so the grid renders immediately
 * and these labels fill in once this resolves. Best-effort — a failure leaves an
 * empty map and the console simply omits the as-of labels.
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

export interface DataFreshnessState {
  /** logical cube name → 'YYYY-MM-DD' the cube's data is current to. */
  asOfByCube: Record<string, string>;
  loaded: boolean;
}

interface FreshnessResponse {
  game: string;
  asOfByCube: Record<string, string>;
}

const EMPTY: DataFreshnessState = { asOfByCube: {}, loaded: false };

export function useCareDataFreshness(gameId: string): DataFreshnessState {
  const [state, setState] = useState<DataFreshnessState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!gameId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState(EMPTY);

    apiFetch<FreshnessResponse>('/api/care/data-freshness', {
      query: { game: gameId },
      signal: controller.signal,
    })
      .then((res) => setState({ asOfByCube: res.asOfByCube ?? {}, loaded: true }))
      .catch((err: unknown) => {
        // Intentional cancel on game switch — leave state untouched.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Best-effort: mark loaded with an empty map so labels are simply omitted.
        setState({ asOfByCube: {}, loaded: true });
      });

    return () => controller.abort();
  }, [gameId]);

  return state;
}
