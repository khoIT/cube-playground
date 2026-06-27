/**
 * Per-segment consumption rollup over public_pull_audit (+ api_keys for labels).
 *
 * Read-only. All rate/latency/freshness math is computed over ENRICHED rows only
 * (audit_schema='v2') so pre-enrichment rows aren't miscounted as failures or
 * zero-latency. Grouping is by key_id (a key has a label, not a stable app
 * identity — a rotated key is a new id; display may dedupe identical labels with a
 * caveat). The headline consumer count is AUDIT-derived (keys that actually
 * pulled), never scope-derived — a wildcard key that never pulled this segment is
 * entitled-but-idle, not a consumer.
 */

import { getDb } from '../db/sqlite.js';
import { listKeys } from '../auth/api-key-store.js';
import { entitledKeysForSegment } from './segment-serving-store.js';

const WINDOW_MS: Record<string, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export function windowStartIso(window: string, nowMs: number): string {
  const ms = WINDOW_MS[window] ?? WINDOW_MS['7d'];
  return new Date(nowMs - ms).toISOString();
}

/** Logical-pull grouping key: a stream row is its own pull; paged rows of one
 *  snapshot-walk collapse to one. Mirrors the global admin rollup. */
const PULL_GROUP = `CASE WHEN page_index IS NULL THEN 's:' || id ELSE 'p:' || key_id || '|' || COALESCE(snapshot_ts, '') END`;

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface ConsumptionSummary {
  pulls: number;
  consumingKeys: number;
  rowsLastPull: number;
  successRate: number;
  p95LatencyMs: number | null;
  avgFreshnessMs: number | null;
  windowStart: string;
}

export interface ByKeyRow {
  keyId: string;
  label: string;
  pulls: number;
  lastPullAt: string | null;
  rowsLast: number;
  lastHttpStatus: number | null;
}

export interface DailyPoint {
  date: string;
  keyId: string;
  pulls: number;
}

export interface StatusBreakdown {
  ok: number;
  no_snapshot: number;
  rate_limited: number;
}

export interface ConsumptionView {
  summary: ConsumptionSummary;
  byKey: ByKeyRow[];
  dailyByKey: DailyPoint[];
  statusBreakdown: StatusBreakdown;
}

function labelFor(keyId: string, labels: Map<string, string>): string {
  return labels.get(keyId) ?? `${keyId.slice(0, 8)}… (revoked/removed)`;
}

export function getConsumption(segmentId: string, window: string, nowMs: number): ConsumptionView {
  const db = getDb();
  const start = windowStartIso(window, nowMs);
  const labels = new Map(listKeys().map((k) => [k.id, k.label]));

  // All enriched rows in window (latency/freshness/status math).
  const rows = db
    .prepare(
      `SELECT id, key_id, started_at, rows_streamed, http_status, snapshot_ts, latency_ms, page_index, error_code
         FROM public_pull_audit
        WHERE segment_id = ? AND audit_schema = 'v2' AND started_at >= ?
        ORDER BY id DESC`,
    )
    .all(segmentId, start) as Array<Record<string, unknown>>;

  const ok = rows.filter((r) => Number(r.http_status) === 200);
  const latencies = ok.map((r) => Number(r.latency_ms)).filter((n) => Number.isFinite(n));
  const freshness = ok
    .filter((r) => r.snapshot_ts)
    .map((r) => Date.parse(String(r.started_at)) - Date.parse(snapshotIso(String(r.snapshot_ts))))
    .filter((n) => Number.isFinite(n) && n >= 0);

  // Logical pulls + audit-derived consuming keys (distinct keys with a 200).
  const pulls = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT 1 FROM public_pull_audit
            WHERE segment_id = ? AND audit_schema = 'v2' AND started_at >= ?
            GROUP BY ${PULL_GROUP})`,
      )
      .get(segmentId, start) as { n: number }
  ).n;
  const consumingKeys = new Set(ok.map((r) => String(r.key_id))).size;

  const summary: ConsumptionSummary = {
    pulls,
    consumingKeys,
    rowsLastPull: ok.length > 0 ? Number(ok[0].rows_streamed) : 0,
    successRate: rows.length > 0 ? ok.length / rows.length : 0,
    p95LatencyMs: p95(latencies),
    avgFreshnessMs: freshness.length > 0 ? Math.round(freshness.reduce((a, b) => a + b, 0) / freshness.length) : null,
    windowStart: start,
  };

  // byKey: group in JS (rows already newest-first). `pulls` counts LOGICAL pulls
  // (paged rows of one snapshot-walk collapse to one) so sum(byKey.pulls) ==
  // summary.pulls — not raw page requests.
  const byKeyMap = new Map<string, ByKeyRow & { groups: Set<string> }>();
  for (const r of rows) {
    const keyId = String(r.key_id);
    const group =
      r.page_index == null ? `s:${r.id}` : `p:${keyId}|${(r.snapshot_ts as string) ?? ''}`;
    let entry = byKeyMap.get(keyId);
    if (!entry) {
      entry = {
        keyId,
        label: labelFor(keyId, labels),
        pulls: 0,
        lastPullAt: String(r.started_at),
        rowsLast: Number(r.rows_streamed),
        lastHttpStatus: r.http_status == null ? null : Number(r.http_status),
        groups: new Set<string>(),
      };
      byKeyMap.set(keyId, entry);
    }
    entry.groups.add(group);
    entry.pulls = entry.groups.size;
  }

  const daily = db
    .prepare(
      `SELECT substr(started_at, 1, 10) AS date, key_id, COUNT(*) AS pulls
         FROM public_pull_audit
        WHERE segment_id = ? AND audit_schema = 'v2' AND started_at >= ?
        GROUP BY date, key_id ORDER BY date ASC`,
    )
    .all(segmentId, start) as Array<{ date: string; key_id: string; pulls: number }>;

  const statusBreakdown: StatusBreakdown = {
    ok: ok.length,
    no_snapshot: rows.filter((r) => r.error_code === 'no_snapshot').length,
    rate_limited: rows.filter((r) => r.error_code === 'rate_limited').length,
  };

  return {
    summary,
    byKey: [...byKeyMap.values()].map(({ groups, ...rest }) => {
      void groups;
      return rest;
    }),
    dailyByKey: daily.map((d) => ({ date: d.date, keyId: d.key_id, pulls: d.pulls })),
    statusBreakdown,
  };
}

/** SQLite snapshot_ts is a GMT+7 wall-clock 'YYYY-MM-DD HH:MM:SS'. Treat it as
 *  GMT+7 (offset +07:00) so freshness@pull (started − snapshot) is in real time. */
function snapshotIso(ts: string): string {
  return ts.includes('T') ? ts : `${ts.replace(' ', 'T')}+07:00`;
}

export interface RecentPull {
  id: number;
  keyId: string;
  label: string;
  startedAt: string;
  httpStatus: number | null;
  errorCode: string | null;
  format: string | null;
  pageIndex: number | null;
  rows: number;
  snapshotTs: string | null;
  latencyMs: number | null;
}

/** Per-page pull log, newest-first, cursor by id (id < cursor). */
export function recentPulls(
  segmentId: string,
  opts: { cursor?: number; limit?: number },
): { items: RecentPull[]; nextCursor: number | null } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const labels = new Map(listKeys().map((k) => [k.id, k.label]));
  const rows = getDb()
    .prepare(
      `SELECT id, key_id, started_at, http_status, error_code, format, page_index, rows_streamed, snapshot_ts, latency_ms
         FROM public_pull_audit
        WHERE segment_id = ? AND (? IS NULL OR id < ?)
        ORDER BY id DESC LIMIT ?`,
    )
    .all(segmentId, opts.cursor ?? null, opts.cursor ?? null, limit + 1) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => ({
    id: Number(r.id),
    keyId: String(r.key_id),
    label: labelFor(String(r.key_id), labels),
    startedAt: String(r.started_at),
    httpStatus: r.http_status == null ? null : Number(r.http_status),
    errorCode: r.error_code ? String(r.error_code) : null,
    format: r.format ? String(r.format) : null,
    pageIndex: r.page_index == null ? null : Number(r.page_index),
    rows: Number(r.rows_streamed),
    snapshotTs: r.snapshot_ts ? String(r.snapshot_ts) : null,
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
  }));
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export interface SegmentToken {
  id: string;
  label: string;
  appliesVia: 'segment' | 'all-segments';
  lastUsedAt: string | null;
  everPulled: boolean;
}

/** Keys ENTITLED to pull this segment (scope + workspace match), each annotated
 *  with whether it has EVER actually pulled it (audit-derived). Separates
 *  entitled-but-idle wildcard keys from real consumers. */
export function tokensForSegment(row: { id: string; workspace: string | null; game_id: string | null }): SegmentToken[] {
  const everPulled = new Set(
    (getDb().prepare('SELECT DISTINCT key_id FROM public_pull_audit WHERE segment_id = ?').all(row.id) as Array<{
      key_id: string;
    }>).map((r) => r.key_id),
  );
  return entitledKeysForSegment(row).map((k) => ({
    id: k.id,
    label: k.label,
    appliesVia: k.appliesVia,
    lastUsedAt: k.lastUsedAt,
    everPulled: everPulled.has(k.id),
  }));
}
