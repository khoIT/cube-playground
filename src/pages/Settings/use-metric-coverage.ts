/**
 * useMetricCoverage — fetches the metric ↔ cube coverage report and exposes
 * a scaffold action. Read-on-demand (no polling): "Refresh" is the explicit
 * "sync to identify gaps" gesture; scaffolding draft stubs auto-refreshes so
 * newly-covered measures drop off the list.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/api-client';

export interface UnresolvedRef {
  metricId: string;
  ref: string;
  reason: 'unparseable' | 'cube-missing' | 'member-missing';
}

export interface GameCoverage {
  game: string;
  status: 'ok' | 'drift' | 'error';
  error?: string;
  cubesInMeta: number;
  measuresInMeta: number;
  brokenRefs: UnresolvedRef[];
  uncoveredMeasures: string[];
}

export type MatrixState = 'resolves' | 'broken' | 'cube-missing';
export interface MatrixCell {
  metricId: string;
  game: string;
  state: MatrixState;
}

export interface CoverageReport {
  games: GameCoverage[];
  matrix: MatrixCell[];
  generatedAt: string;
}

export interface ScaffoldResult {
  created: string[];
  skipped: Array<{ ref: string; reason: string }>;
}

export interface UseMetricCoverageResult {
  report: CoverageReport | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  scaffold: (refs: string[]) => Promise<ScaffoldResult>;
}

export function useMetricCoverage(): UseMetricCoverageResult {
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiFetch<CoverageReport>('/api/business-metrics/coverage');
      setReport(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const scaffold = useCallback(
    async (refs: string[]): Promise<ScaffoldResult> => {
      const result = await apiFetch<ScaffoldResult>('/api/business-metrics/scaffold', {
        method: 'POST',
        body: { measures: refs.map((ref) => ({ ref })) },
      });
      await refetch(); // newly-covered measures should disappear
      return result;
    },
    [refetch],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { report, loading, error, refetch, scaffold };
}
