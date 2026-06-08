/**
 * useMember360Coverage — fetches `GET /api/workspaces/:id/member360-coverage`.
 *
 * One report covers every game in the workspace (server-cached 60s), so both
 * the admin coverage matrix and the per-segment end-user states share a single
 * fetch. Mirrors `server/src/services/member360-coverage.ts` types verbatim.
 *
 * Refetches when the workspace id changes; exposes `refetch` for the admin
 * panel's manual refresh.
 */

import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../api/api-client';

export type PanelCoverageStatus = 'ready' | 'partial' | 'empty' | 'blocked';
export type GameCoverageStatus = PanelCoverageStatus | 'na' | 'error';

export interface PanelCoverage {
  id: string;
  title: string;
  view: string;
  status: PanelCoverageStatus | 'error';
  modeledMembers: number;
  totalMembers: number;
  missingMembers: string[];
  hasRows: boolean | null;
  error?: string;
}

export interface GameCoverage {
  game: string;
  label: string;
  has360Config: boolean;
  status: GameCoverageStatus;
  panels: PanelCoverage[];
  note?: string;
}

export interface Member360CoverageReport {
  workspace: { id: string; label: string; gameModel: 'game_id' | 'prefix' };
  prefixUnsupported: boolean;
  generatedAt: string;
  games: GameCoverage[];
}

export interface UseMember360CoverageResult {
  report: Member360CoverageReport | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Select one game's coverage from a report (end-user surfaces read one game). */
export function findGameCoverage(
  report: Member360CoverageReport | null,
  gameId: string | null | undefined,
): GameCoverage | null {
  if (!report || !gameId) return null;
  return report.games.find((g) => g.game === gameId) ?? null;
}

export function useMember360Coverage(
  workspaceId: string | null,
): UseMember360CoverageResult {
  const [report, setReport] = useState<Member360CoverageReport | null>(null);
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
      const next = await apiFetch<Member360CoverageReport>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/member360-coverage`,
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
