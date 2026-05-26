/**
 * Phase 08 — fetch the append-only audit history for a single business
 * metric. Backed by `GET /api/business-metrics/:id/history` (server route in
 * `server/src/routes/business-metrics.ts:262`). Newest-first, default limit
 * 50 (max 500 server-side).
 *
 * Defensive: network errors render an empty list rather than throwing, so
 * the History tab degrades into a friendly empty state instead of crashing
 * the metric detail page when the API is briefly unavailable.
 */
import { useCallback, useEffect, useState } from 'react';

export type AuditAction = 'create' | 'update' | 'trust_change' | 'delete';
export type ActorKind = 'user' | 'agent' | 'system';

export interface AuditEntry {
  id: number;
  ts: number;
  metricId: string;
  action: AuditAction;
  oldValueJson: string | null;
  newValueJson: string | null;
  actorKind: ActorKind;
  actorId: string | null;
  reason: string | null;
  requestId: string | null;
}

export interface UseBusinessMetricHistory {
  entries: AuditEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useBusinessMetricHistory(metricId: string, limit = 50): UseBusinessMetricHistory {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!metricId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/business-metrics/${encodeURIComponent(metricId)}/history?limit=${limit}`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
      );
      if (!res.ok) {
        setError(`history endpoint returned ${res.status}`);
        setEntries([]);
        return;
      }
      const body = (await res.json()) as { entries?: AuditEntry[] };
      setEntries(body.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [metricId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}
