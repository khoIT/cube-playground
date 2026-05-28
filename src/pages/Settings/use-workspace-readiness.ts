/**
 * useWorkspaceReadiness — fetches `GET /api/workspaces/:id/readiness` for the
 * given workspace id. Refetches when the id changes; exposes an explicit
 * `refetch` so the tab can re-run after the user switches games or scaffolds.
 */

import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../../api/api-client';

export type GameReadinessStatus = 'ok' | 'missing' | 'error';

export interface GameReadiness {
  id: string;
  label: string;
  prefix: string | null;
  status: GameReadinessStatus;
  cubeCount: number;
  error?: string;
}

export interface ArtifactCounts {
  dashboards: number;
  segments: number;
  cubeAliases: number;
}

export interface UnresolvedRef {
  metricId: string;
  ref: string;
  reason: 'unparseable' | 'cube-missing' | 'member-missing';
}

export interface CoverageGame {
  game: string;
  status: 'ok' | 'drift' | 'error';
  error?: string;
  cubesInMeta: number;
  measuresInMeta: number;
  brokenRefs: UnresolvedRef[];
  uncoveredMeasures: string[];
}

export interface CoverageReport {
  games: CoverageGame[];
  generatedAt: string;
}

export interface WorkspaceReadinessReport {
  workspace: { id: string; label: string; gameModel: 'game_id' | 'prefix'; authMode: 'none' | 'minted' | 'env-token' };
  generatedAt: string;
  games: GameReadiness[];
  coverage: CoverageReport;
  artifacts: ArtifactCounts;
}

export interface UseWorkspaceReadinessResult {
  report: WorkspaceReadinessReport | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useWorkspaceReadiness(workspaceId: string | null): UseWorkspaceReadinessResult {
  const [report, setReport] = useState<WorkspaceReadinessReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!workspaceId) {
      setReport(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await apiFetch<WorkspaceReadinessReport>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/readiness`,
      );
      setReport(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { report, loading, error, refetch };
}
