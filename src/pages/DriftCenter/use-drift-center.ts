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

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/api-client';
import { useWorkspaceContext } from '../../components/workspace-context';

interface MetaCube {
  name: string;
  measures?: Array<{ name: string }>;
  dimensions?: Array<{ name: string }>;
}

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

  // Drift + members are scoped to BOTH the active game and the active workspace
  // (a prefix workspace short-circuits; local vs prod expose different cubes).
  // apiFetch reads the workspace from localStorage at call time; we thread
  // workspaceId into the effect/callback deps so switching workspace (game
  // unchanged) re-fetches instead of leaving stale drift + an empty picker.
  const { workspaceId } = useWorkspaceContext();

  // Live /meta members for the repoint picker. Fetched directly from the same
  // proxy the server reconciles against (`/cube-api/v1/meta?extended=true`) so
  // it's self-contained — it does NOT depend on the QueryBuilder having
  // registered AppContext.apiUrl (the Drift Center route never mounts it, which
  // is why reusing useCatalogMeta returned an empty list). apiFetch adds the
  // x-cube-workspace header + app token; x-cube-game is what actually scopes
  // the schema (see docs/lessons-learned.md).
  const [members, setMembers] = useState<MetaMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  useEffect(() => {
    if (!gameId) {
      setMembers([]);
      setMembersLoading(false);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    apiFetch<{ cubes?: MetaCube[] }>('/cube-api/v1/meta', {
      query: { extended: 'true' },
      headers: { 'x-cube-game': gameId },
    })
      .then((meta) => {
        if (cancelled) return;
        const out: MetaMember[] = [];
        for (const cube of meta.cubes ?? []) {
          for (const m of cube.measures ?? []) out.push({ ref: m.name, kind: 'measure' });
          for (const d of cube.dimensions ?? []) out.push({ ref: d.name, kind: 'dimension' });
        }
        out.sort((a, b) => a.ref.localeCompare(b.ref));
        setMembers(out);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, workspaceId]);

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
  }, [gameId, workspaceId]);

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
