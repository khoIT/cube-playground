/**
 * useDriftRuns — detector run history + schedule for the active game, feeding the
 * "Detector runs" tab. Reads GET /drift-runs, exposes a "Run now" mutation (POST
 * /drift-runs/run), and live-polls every 30s so new scheduled runs appear without
 * a manual refresh. Runs are per-game and local-only (the detector reconciles
 * against the local game_id model), so this keys on gameId — not the workspace.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/api-client';

const POLL_MS = 30_000;

export type DriftRunStatus = 'ok' | 'skipped' | 'error';
export type DriftRunSource = 'detector' | 'manual';

export interface DriftRun {
  id: number;
  game: string;
  source: DriftRunSource;
  status: DriftRunStatus;
  startedAt: string;
  finishedAt: string;
  totalUnresolved: number;
  rootCauseCount: number;
  newCount: number;
  resolvedCount: number;
  cubeMissing: number;
  memberMissing: number;
  unparseable: number;
}

export interface DriftRunsReport {
  game: string;
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runs: DriftRun[];
}

export interface UseDriftRunsResult {
  report: DriftRunsReport | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  refetch: () => Promise<void>;
  runNow: () => Promise<void>;
}

export function useDriftRuns(gameId: string | null | undefined): UseDriftRunsResult {
  const [report, setReport] = useState<DriftRunsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Avoid a poll tick clobbering an in-flight manual run with stale data.
  const runningRef = useRef(false);

  const fetchRuns = useCallback(
    async (showLoading: boolean) => {
      if (!gameId) {
        setReport(null);
        setLoading(false);
        return;
      }
      if (showLoading) setLoading(true);
      try {
        const next = await apiFetch<DriftRunsReport>('/api/business-metrics/drift-runs', {
          query: { game: gameId, limit: '10' },
        });
        if (!runningRef.current) {
          setReport(next);
          setError(null);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [gameId],
  );

  const refetch = useCallback(() => fetchRuns(true), [fetchRuns]);

  const runNow = useCallback(async () => {
    if (!gameId) return;
    setRunning(true);
    runningRef.current = true;
    setError(null);
    try {
      const next = await apiFetch<DriftRunsReport>('/api/business-metrics/drift-runs/run', {
        method: 'POST',
        body: { game: gameId },
      });
      setReport(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [gameId]);

  // Initial load + 30s live poll (silent — no loading flicker).
  useEffect(() => {
    void fetchRuns(true);
    if (!gameId) return;
    const id = setInterval(() => void fetchRuns(false), POLL_MS);
    return () => clearInterval(id);
  }, [gameId, fetchRuns]);

  return { report, loading, error, running, refetch, runNow };
}
