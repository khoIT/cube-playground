/**
 * Audit log for public full-cohort pulls (a PII surface — uids leave the system).
 *
 * A row is OPENED when a stream starts (status 'streaming') and FINALIZED on
 * close with the authoritative row count + terminal status. Finalizing in the
 * socket-close handler means even a crashed/aborted stream gets a terminal row
 * (marked 'aborted' / 'error') rather than a dangling 'streaming' one.
 */

import { getDb } from '../db/sqlite.js';
import type { ExportSourcePath } from '../services/segment-export-stream.js';

export interface OpenAuditInput {
  keyId: string;
  segmentId: string;
  format: string;
  clientIp?: string | null;
}

/** Insert a 'streaming' row; returns its id for later finalize. `audit_schema`
 *  marks the row as enriched ('v2') so the consumption rollup can exclude any
 *  pre-enrichment rows from rate/latency/freshness math. */
export function openPullAudit(input: OpenAuditInput): number {
  const res = getDb()
    .prepare(
      `INSERT INTO public_pull_audit (key_id, segment_id, started_at, format, status, client_ip, audit_schema)
       VALUES (?, ?, ?, ?, 'streaming', ?, 'v2')`,
    )
    .run(input.keyId, input.segmentId, new Date().toISOString(), input.format, input.clientIp ?? null);
  return Number(res.lastInsertRowid);
}

/** Record which source path the resolver picked (table vs live). */
export function setPullAuditSource(id: number, source: ExportSourcePath): void {
  getDb().prepare('UPDATE public_pull_audit SET source = ? WHERE id = ?').run(source, id);
}

export type PullAuditStatus = 'complete' | 'aborted' | 'error';

/** Close a stream row with the final count + terminal status, and (optionally)
 *  latency + http status for the enriched consumption view. */
export function finalizePullAudit(
  id: number,
  rows: number,
  status: PullAuditStatus,
  opts?: { latencyMs?: number; httpStatus?: number },
): void {
  getDb()
    .prepare(
      `UPDATE public_pull_audit
          SET finished_at = ?, rows_streamed = ?, status = ?, latency_ms = ?, http_status = ?
        WHERE id = ?`,
    )
    .run(
      new Date().toISOString(),
      rows,
      status,
      opts?.latencyMs ?? null,
      opts?.httpStatus ?? (status === 'complete' ? 200 : null),
      id,
    );
}

export interface RecordPagePullInput {
  keyId: string;
  segmentId: string;
  /** ISO of when this page request began (for freshness@pull = started − snapshot). */
  startedAt: string;
  /** 0-based page index for a delivered page; null for a failed/throttled attempt
   *  (which is its own logical event, not part of a page walk). */
  pageIndex: number | null;
  pageId: string | null;
  rows: number;
  latencyMs: number;
  snapshotTs: string | null;
  httpStatus: number;
  format: string;
  source?: string | null;
  clientIp?: string | null;
  /** Authenticated failure only: 'no_snapshot' | 'rate_limited' | 'bad_fields'. */
  errorCode?: string | null;
}

/** Record one authenticated paginated page request as its own enriched row. Every
 *  row has a real key_id + segment_id (failed-AUTH never reaches here — it logs).
 *  Insert is best-effort: a logging failure must never break a pull, so callers
 *  wrap this in try/catch. */
export function recordPagePull(input: RecordPagePullInput): void {
  getDb()
    .prepare(
      `INSERT INTO public_pull_audit
         (key_id, segment_id, started_at, finished_at, rows_streamed, source, format, status, client_ip,
          page_index, page_id, latency_ms, snapshot_ts, http_status, error_code, audit_schema)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v2')`,
    )
    .run(
      input.keyId,
      input.segmentId,
      input.startedAt,
      new Date().toISOString(),
      input.rows,
      input.source ?? null,
      input.format,
      input.httpStatus === 200 ? 'complete' : 'error',
      input.clientIp ?? null,
      input.pageIndex,
      input.pageId,
      input.latencyMs,
      input.snapshotTs,
      input.httpStatus,
      input.errorCode ?? null,
    );
}

/** Drop audit rows older than the retention window. Per-page auditing multiplies
 *  row volume (one row per page), so this keeps the table bounded. Returns the
 *  number of rows removed. */
export function prunePullAudit(retentionDays = 90): number {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const res = getDb().prepare('DELETE FROM public_pull_audit WHERE started_at < ?').run(cutoff);
  return res.changes;
}

export interface PullAuditItem {
  id: number;
  keyId: string;
  segmentId: string;
  startedAt: string;
  finishedAt: string | null;
  rowsStreamed: number;
  source: string | null;
  format: string | null;
  status: string;
  clientIp: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  snapshotTs: string | null;
  latencyMs: number | null;
  /** Number of page requests rolled into this logical pull (null = stream/whole). */
  pageCount: number | null;
}

/**
 * Most-recent audit rows (global admin view), rolled up to ONE row per logical
 * pull. A stream pull is already one row (page_index NULL → grouped by its own id).
 * A paginated pull writes one row per page; those are grouped by
 * (key, segment, snapshot_ts) so the admin's "Recent pulls" count doesn't jump Nx
 * after per-page auditing ships. The group is represented by its NEWEST row (final
 * page status/error), with rows summed and page_count = pages walked.
 */
export function listPullAudit(limit = 200): PullAuditItem[] {
  const rows = getDb()
    .prepare(
      `WITH grouped AS (
         SELECT MAX(id) AS rep_id,
                SUM(rows_streamed) AS total_rows,
                MIN(started_at) AS first_started,
                CASE WHEN page_index IS NULL THEN NULL ELSE COUNT(*) END AS page_count
           FROM public_pull_audit
          GROUP BY CASE WHEN page_index IS NULL
                        THEN 's:' || id
                        ELSE 'p:' || key_id || '|' || segment_id || '|' || COALESCE(snapshot_ts, '') END
       )
       SELECT a.id, a.key_id, a.segment_id, g.first_started AS started_at, a.finished_at,
              g.total_rows AS rows_streamed, a.source, a.format, a.status, a.client_ip,
              a.http_status, a.error_code, a.snapshot_ts, a.latency_ms, g.page_count
         FROM grouped g JOIN public_pull_audit a ON a.id = g.rep_id
        ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    keyId: String(r.key_id),
    segmentId: String(r.segment_id),
    startedAt: String(r.started_at),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
    rowsStreamed: Number(r.rows_streamed),
    source: r.source ? String(r.source) : null,
    format: r.format ? String(r.format) : null,
    status: String(r.status),
    clientIp: r.client_ip ? String(r.client_ip) : null,
    httpStatus: r.http_status == null ? null : Number(r.http_status),
    errorCode: r.error_code ? String(r.error_code) : null,
    snapshotTs: r.snapshot_ts ? String(r.snapshot_ts) : null,
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
    pageCount: r.page_count == null ? null : Number(r.page_count),
  }));
}
