/**
 * use-care-sweeps — hooks over the /api/care/sweeps/* read endpoints that power
 * the Sweeps comparison lens: run list (picker), cohort-size trend per playbook,
 * two-run diff (per-playbook deltas + entered/left counts), and the paginated
 * entered/left VIP drill. Mirrors the AbortController pattern in use-care-cases.
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../api/api-client';
import { DEFAULT_PAGE_SIZE, type CareVipProfileDto } from './use-care-cases';

export interface SweepRun {
  runId: string;
  source: 'manual' | 'cron';
  status: 'ok' | 'partial' | 'error';
  startedAt: string;
  finishedAt: string;
  openedTotal: number;
  lapsedTotal: number;
  profilesRefreshed: number;
}

export interface TrendPoint {
  runId: string;
  startedAt: string;
  cohortSize: number;
}
export interface PlaybookTrend {
  playbookId: string;
  points: TrendPoint[];
}

export interface PlaybookDiff {
  playbookId: string;
  cohortA: number;
  cohortB: number;
  cohortDelta: number;
  enteredCount: number;
  leftCount: number;
}
export interface SweepDiff {
  membershipAvailable: boolean;
  playbooks: PlaybookDiff[];
}

export interface DiffVip {
  uid: string;
  profile: CareVipProfileDto | null;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

/** Shared fetch effect: runs `path`+`query` when `enabled`, into a typed state. */
function useApiResource<T>(
  path: string,
  query: Record<string, string> | null,
  enabled: boolean,
  initial: T,
): { status: Status; data: T; error: string | null } {
  const [state, setState] = useState<{ status: Status; data: T; error: string | null }>({
    status: 'idle',
    data: initial,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const key = query ? JSON.stringify(query) : '';

  useEffect(() => {
    if (!enabled || !query) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    apiFetch<T>(path, { query, signal: controller.signal })
      .then((data) => setState({ status: 'success', data, error: null }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState((prev) => ({ ...prev, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }));
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);

  return state;
}

export function useSweepRuns(gameId: string) {
  const s = useApiResource<{ runs: SweepRun[] }>('/api/care/sweeps/runs', gameId ? { game: gameId, limit: '50' } : null, !!gameId, { runs: [] });
  return { status: s.status, runs: s.data.runs, error: s.error };
}

export function useSweepTrend(gameId: string) {
  const s = useApiResource<{ trends: PlaybookTrend[] }>('/api/care/sweeps/trend', gameId ? { game: gameId } : null, !!gameId, { trends: [] });
  return { status: s.status, trends: s.data.trends, error: s.error };
}

export function useSweepDiff(gameId: string, runA: string | null, runB: string | null) {
  const enabled = !!gameId && !!runA && !!runB && runA !== runB;
  const s = useApiResource<SweepDiff>(
    '/api/care/sweeps/diff',
    enabled ? { game: gameId, runA: runA as string, runB: runB as string } : null,
    enabled,
    { membershipAvailable: true, playbooks: [] },
  );
  return { status: s.status, diff: s.data, error: s.error };
}

export function useSweepDiffVips(
  gameId: string,
  runA: string | null,
  runB: string | null,
  playbook: string | null,
  direction: 'entered' | 'left',
  page: number,
) {
  const enabled = !!gameId && !!runA && !!runB && !!playbook;
  const s = useApiResource<{ vips: DiffVip[]; total: number; pageSize: number; membershipAvailable: boolean }>(
    '/api/care/sweeps/diff/vips',
    enabled
      ? {
          game: gameId,
          runA: runA as string,
          runB: runB as string,
          playbook: playbook as string,
          direction,
          page: String(page),
          pageSize: String(DEFAULT_PAGE_SIZE),
        }
      : null,
    enabled,
    { vips: [], total: 0, pageSize: DEFAULT_PAGE_SIZE, membershipAvailable: true },
  );
  return {
    status: s.status,
    vips: s.data.vips,
    total: s.data.total,
    pageSize: s.data.pageSize,
    membershipAvailable: s.data.membershipAvailable,
    error: s.error,
  };
}
