/**
 * useArtifactSweep — button-triggered sweep of saved artifacts for a workspace.
 * Calls POST /api/workspaces/:id/artifact-sweep with { live }.
 * No auto-fetch on mount or workspace switch — explicit run() only.
 */

import { useCallback, useState } from 'react';
import { apiFetch } from '../../api/api-client';

// ---------------------------------------------------------------------------
// Types mirroring server/src/services/artifact-validation-sweep.ts
// ---------------------------------------------------------------------------

export type ArtifactStatus =
  | 'ok'
  | 'unverified'
  | 'missing-member'
  | 'missing-preagg'
  | 'runtime-error';

export interface ArtifactResult {
  kind: 'dashboard' | 'segment' | 'chat';
  id: string;
  game: string | null;
  title: string;
  status: ArtifactStatus;
  detail?: string;
  refs?: string[];
}

export interface SweepSummary {
  total: number;
  ok: number;
  unverified: number;
  missingMember: number;
  missingPreagg: number;
  runtimeError: number;
}

export interface SweepResult {
  dashboards: ArtifactResult[];
  segments: ArtifactResult[];
  chatArtifacts: ArtifactResult[];
  summary: SweepSummary;
  generatedAt: string;
  note?: string;
}

export interface UseArtifactSweepResult {
  result: SweepResult | null;
  running: boolean;
  error: string | null;
  run: (live: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useArtifactSweep(workspaceId: string | null): UseArtifactSweepResult {
  const [result, setResult] = useState<SweepResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (live: boolean) => {
      if (!workspaceId || running) return;
      setRunning(true);
      setError(null);
      try {
        const data = await apiFetch<SweepResult>(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/artifact-sweep`,
          { method: 'POST', body: { live } },
        );
        setResult(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [workspaceId, running],
  );

  return { result, running, error, run };
}
