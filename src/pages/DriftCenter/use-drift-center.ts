/**
 * useDriftCenter — fetches the root-cause-grouped drift report for the active
 * game and exposes the two mutations (repoint, mark-N/A). Read-on-demand:
 * "Refresh" re-reconciles; a successful mutation refetches so a fixed group
 * disappears. Modeled on `use-metric-coverage.ts`.
 *
 * The repoint picker's member list comes from the live `/meta` of the active
 * workspace+game — reused via `useCatalogMeta` (the same proxy fetch the
 * Catalog uses), flattened to fully-qualified `cube.member` strings. No new
 * endpoint.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/api-client';
import { useCatalogMeta } from '../Catalog/use-catalog-meta';

export type DriftReason = 'unparseable' | 'cube-missing' | 'member-missing';

export interface DriftItem {
  metricId: string;
  ref: string;
}

export interface RootCauseGroup {
  kind: DriftReason;
  key: string;
  reason: DriftReason;
  affectedMetricIds: string[];
  affectedCount: number;
  refs: string[];
  items: DriftItem[];
}

export interface DetectorPanel {
  groups: RootCauseGroup[];
  updatedAt: string | null;
}

export interface DriftCenterReport {
  game: string;
  groups: RootCauseGroup[];
  detectorPanel: DetectorPanel;
  prefixUnsupported: boolean;
  generatedAt: string;
}

export interface MetaMember {
  ref: string; // fully-qualified cube.member
  kind: 'measure' | 'dimension';
}

export interface UseDriftCenterResult {
  report: DriftCenterReport | null;
  loading: boolean;
  error: string | null;
  /** Live /meta members for the repoint picker (active workspace+game). */
  members: MetaMember[];
  membersLoading: boolean;
  refetch: () => Promise<void>;
  repoint: (metricId: string, from: string, to: string) => Promise<void>;
  markNa: (metricId: string, applicable: boolean) => Promise<void>;
}

export function useDriftCenter(gameId: string | null | undefined): UseDriftCenterResult {
  const [report, setReport] = useState<DriftCenterReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live /meta members for the picker — reuse the Catalog's proxy fetch.
  const { cubes, loading: membersLoading } = useCatalogMeta();
  const members = useMemo<MetaMember[]>(() => {
    const out: MetaMember[] = [];
    for (const cube of cubes) {
      for (const m of cube.measures ?? []) out.push({ ref: m.name, kind: 'measure' });
      for (const d of cube.dimensions ?? []) out.push({ ref: d.name, kind: 'dimension' });
    }
    return out.sort((a, b) => a.ref.localeCompare(b.ref));
  }, [cubes]);

  const refetch = useCallback(async () => {
    if (!gameId) {
      setReport(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await apiFetch<DriftCenterReport>('/api/business-metrics/drift-center', {
        query: { game: gameId },
      });
      setReport(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  const repoint = useCallback(
    async (metricId: string, from: string, to: string) => {
      await apiFetch(`/api/business-metrics/${encodeURIComponent(metricId)}/repoint`, {
        method: 'PATCH',
        body: { from, to, game: gameId },
      });
      await refetch();
    },
    [gameId, refetch],
  );

  const markNa = useCallback(
    async (metricId: string, applicable: boolean) => {
      if (!gameId) return;
      await apiFetch(`/api/business-metrics/${encodeURIComponent(metricId)}/applicability`, {
        method: 'PATCH',
        body: { game: gameId, applicable },
      });
      await refetch();
    },
    [gameId, refetch],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { report, loading, error, members, membersLoading, refetch, repoint, markNa };
}
