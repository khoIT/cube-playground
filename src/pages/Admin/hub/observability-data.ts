/**
 * Data layer for the Observability tab + audit-log viewer.
 *
 *   useActivitySummary()  → GET /api/admin/activity/summary (org rollup)
 *   useAuditLog(filters)  → GET /api/admin/audit            (filtered log)
 *
 * All requests go through apiFetch (auto Bearer JWT) — the routes sit behind
 * requireRole('admin'), so a bare fetch() would 401 in real-auth (prod) mode.
 *
 * Pure helpers (CSV serialization, query-string building) are exported for
 * unit testing without a render.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

// ── Shapes (mirror server: activity-aggregator.ts + access-audit-store.ts) ────

export interface InactiveUser {
  email: string;
  lastLogin: string | null;
  status: string;
}

export interface ActivitySummary {
  usersByStatus: Record<string, number>;
  activeLast7d: number;
  activeLast30d: number;
  inactive: InactiveUser[];
  topFeatures: Array<{ feature: string; count: number }>;
  totalChatTurns: number | null;
  generatedAt: number;
}

export interface AuditEntry {
  id: number;
  actorEmail: string;
  action: string;
  targetEmail: string;
  detail: unknown;
  ts: string;
}

export interface AuditFilters {
  actor?: string;
  action?: string;
  target?: string;
  from?: string;
  to?: string;
  limit?: number;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Build the /api/admin/audit query string from filters (omits empties). */
export function auditQueryString(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.action) params.set('action', filters.action);
  if (filters.target) params.set('target', filters.target);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** RFC-4180-ish CSV field escaping: wrap in quotes + double internal quotes. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Serialize audit rows to CSV. The `detail` column is the JSON payload of the
 * grant change — by construction this never contains query-filter values or
 * UIDs (the only writers are the access-management mutators), so the export
 * carries no member-level PII.
 */
export function auditEntriesToCsv(entries: AuditEntry[]): string {
  const header = ['id', 'ts', 'actor', 'action', 'target', 'detail'];
  const rows = entries.map((e) =>
    [
      String(e.id),
      e.ts,
      e.actorEmail,
      e.action,
      e.targetEmail,
      e.detail == null ? '' : JSON.stringify(e.detail),
    ]
      .map(csvField)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useActivitySummary() {
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ActivitySummary>('/api/admin/activity/summary')
      .then(setSummary)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { summary, loading, error, refetch };
}

export function useAuditLog(filters: AuditFilters) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = auditQueryString(filters);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ entries: AuditEntry[] }>(`/api/admin/audit${qs}`)
      .then((data) => setEntries(data.entries ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [qs]);

  useEffect(() => { refetch(); }, [refetch]);

  return { entries, loading, error, refetch };
}
