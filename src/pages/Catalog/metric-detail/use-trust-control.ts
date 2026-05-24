/**
 * useTrustControl — submits PATCH /api/business-metrics/:id/trust and
 * invalidates `useBusinessMetrics` so the badge reflects the new state.
 *
 * Returns `{ submit, submitting }`. `submit` resolves to a discriminated
 * union (ok | error) so callers can show structured toasts (in particular,
 * `REFS_UNRESOLVED` reuses the same `missingRefs` shape as the runnability
 * check).
 */

import { useCallback, useState } from 'react';

import { useActiveGameId } from '../../../components/Header/use-game-context';
import type {
  BusinessMetric,
  BusinessMetricTrust,
} from '../metrics-tab/business-metric-types';
import { useBusinessMetrics } from '../metrics-tab/use-business-metrics';

export type TrustControlError =
  | { code: 'REFS_UNRESOLVED'; message: string; missingRefs: string[] }
  | { code: 'GAME_UNKNOWN'; message: string }
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'VALIDATION'; message: string }
  | { code: 'WRITE_FAILED'; message: string }
  | { code: 'NETWORK'; message: string };

export type TrustControlResult =
  | { ok: true; metric: BusinessMetric }
  | { ok: false; error: TrustControlError };

interface UseTrustControlResult {
  submit: (
    metricId: string,
    trust: BusinessMetricTrust,
    note?: string,
  ) => Promise<TrustControlResult>;
  submitting: boolean;
}

export function useTrustControl(): UseTrustControlResult {
  const gameId = useActiveGameId();
  const { refresh } = useBusinessMetrics(gameId);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (
      metricId: string,
      trust: BusinessMetricTrust,
      note?: string,
    ): Promise<TrustControlResult> => {
      setSubmitting(true);
      try {
        const qs = gameId ? `?game=${encodeURIComponent(gameId)}` : '';
        const res = await fetch(
          `/api/business-metrics/${encodeURIComponent(metricId)}/trust${qs}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trust, ...(note ? { note } : {}) }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: TrustControlError;
          };
          const err: TrustControlError = body.error ?? {
            code: 'WRITE_FAILED',
            message: `HTTP ${res.status}`,
          };
          return { ok: false, error: err };
        }
        const metric = (await res.json()) as BusinessMetric;
        refresh();
        return { ok: true, metric };
      } catch (e) {
        return {
          ok: false,
          error: {
            code: 'NETWORK',
            message: e instanceof Error ? e.message : String(e),
          },
        };
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, refresh],
  );

  return { submit, submitting };
}
