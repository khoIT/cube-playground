/**
 * Data hooks for the Model Audit console. All endpoints are admin-gated server
 * side; auth rides on the shared chat headers (same lane the DevAudit admin
 * surfaces use). Every fetcher aborts on unmount and surfaces {data,error,isLoading}.
 */

import { useCallback, useEffect, useState } from 'react';
import { chatHeaders } from '../../api/chat-auth-headers';
import type {
  ParityRun,
  ParityFinding,
  RunDetail,
  DevVsProdDiff,
  VersionDiff,
  CubeVersion,
  ProdCloneStatus,
  RefreshResult,
  RunAuditResult,
} from './model-audit-types';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

const IDLE = { data: null, error: null, isLoading: false };

function useFetch<T>(url: string | null, deps: unknown[]): AsyncState<T> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<T>>(IDLE);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState({ data: null, error: null, isLoading: true });
    fetch(url, { headers: chatHeaders(), signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<T>;
      })
      .then((data) => setState({ data, error: null, isLoading: false }))
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setState({ data: null, error: err.message, isLoading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);

  return { ...state, refetch };
}

export function useParityRuns() {
  return useFetch<{ runs: ParityRun[] }>('/api/cube-parity/runs', []);
}

export function useRunDetail(runId: number | 'latest' | null) {
  const url = runId == null ? null : `/api/cube-parity/runs/${runId}`;
  return useFetch<RunDetail>(url, [runId]);
}

export function useRunFindings(runId: number | 'latest' | null) {
  const url = runId == null ? null : `/api/cube-parity/runs/${runId}/findings`;
  return useFetch<{ runId: number; findings: ParityFinding[] }>(url, [runId]);
}

export function useDevVsProdDiff(game: string | null, cube: string | null, runId?: number) {
  const url =
    game && cube
      ? `/api/cube-parity/diff/dev-vs-prod?game=${encodeURIComponent(game)}&cube=${encodeURIComponent(cube)}${
          runId ? `&runId=${runId}` : ''
        }`
      : null;
  return useFetch<DevVsProdDiff>(url, [game, cube, runId]);
}

export function useVersionDiff(
  game: string | null,
  cube: string | null,
  from: number | null,
  to: number | null,
) {
  const url =
    game && cube && from != null && to != null
      ? `/api/cube-parity/diff/versions?game=${encodeURIComponent(game)}&cube=${encodeURIComponent(
          cube,
        )}&from=${from}&to=${to}`
      : null;
  return useFetch<VersionDiff>(url, [game, cube, from, to]);
}

export function useCubeVersions(game: string | null, cube: string | null) {
  const url =
    game && cube
      ? `/api/cube-parity/versions?game=${encodeURIComponent(game)}&cube=${encodeURIComponent(cube)}`
      : null;
  return useFetch<{ game: string; cube: string; versions: CubeVersion[] }>(url, [game, cube]);
}

export function useProdStatus() {
  return useFetch<ProdCloneStatus>('/api/cube-parity/prod-status', []);
}

/** POST helper for the two mutating actions (run-audit, refresh-prod). */
function usePost<T>(url: string): { run: () => Promise<T | null>; isLoading: boolean; error: string | null } {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: chatHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [url]);
  return { run, isLoading, error };
}

export function useRunAudit() {
  return usePost<RunAuditResult>('/api/cube-parity/run-audit');
}

export function useRefreshProd() {
  return usePost<RefreshResult>('/api/cube-parity/refresh-prod');
}
