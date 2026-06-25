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

/** Insert a 'streaming' row; returns its id for later finalize. */
export function openPullAudit(input: OpenAuditInput): number {
  const res = getDb()
    .prepare(
      `INSERT INTO public_pull_audit (key_id, segment_id, started_at, format, status, client_ip)
       VALUES (?, ?, ?, ?, 'streaming', ?)`,
    )
    .run(input.keyId, input.segmentId, new Date().toISOString(), input.format, input.clientIp ?? null);
  return Number(res.lastInsertRowid);
}

/** Record which source path the resolver picked (table vs live). */
export function setPullAuditSource(id: number, source: ExportSourcePath): void {
  getDb().prepare('UPDATE public_pull_audit SET source = ? WHERE id = ?').run(source, id);
}

export type PullAuditStatus = 'complete' | 'aborted' | 'error';

/** Close the row with the final row count + terminal status. */
export function finalizePullAudit(id: number, rows: number, status: PullAuditStatus): void {
  getDb()
    .prepare('UPDATE public_pull_audit SET finished_at = ?, rows_streamed = ?, status = ? WHERE id = ?')
    .run(new Date().toISOString(), rows, status, id);
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
}

/** Most-recent audit rows (admin view). */
export function listPullAudit(limit = 200): PullAuditItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, key_id, segment_id, started_at, finished_at, rows_streamed, source, format, status, client_ip
         FROM public_pull_audit ORDER BY id DESC LIMIT ?`,
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
  }));
}
