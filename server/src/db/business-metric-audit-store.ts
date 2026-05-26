/**
 * Append-only audit log for business-metric mutations.
 *
 * Write path: `insertAuditRow` is called by the POST / PATCH /trust handlers
 * after a successful YAML write. Best-effort — a YAML write that succeeds but
 * a later audit insert that fails would leave the rows out of sync; we log
 * + swallow rather than reverse the YAML write (which has already been
 * observed by anyone watching the file).
 *
 * Read path: `listAudit` for a single metric, newest-first, with pagination.
 */

import type Database from 'better-sqlite3';

export type AuditAction = 'create' | 'update' | 'trust_change' | 'delete';
export type ActorKind = 'user' | 'agent' | 'system';

export interface AuditRowInput {
  metricId: string;
  action: AuditAction;
  oldValueJson?: string | null;
  newValueJson?: string | null;
  actorKind: ActorKind;
  actorId?: string | null;
  reason?: string | null;
  requestId?: string | null;
  /** Defaults to Date.now(); injectable for tests. */
  ts?: number;
}

export interface AuditRow {
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

interface RawRow {
  id: number;
  ts: number;
  metric_id: string;
  action: AuditAction;
  old_value_json: string | null;
  new_value_json: string | null;
  actor_kind: ActorKind;
  actor_id: string | null;
  reason: string | null;
  request_id: string | null;
}

function rowFromRaw(r: RawRow): AuditRow {
  return {
    id: r.id,
    ts: r.ts,
    metricId: r.metric_id,
    action: r.action,
    oldValueJson: r.old_value_json,
    newValueJson: r.new_value_json,
    actorKind: r.actor_kind,
    actorId: r.actor_id,
    reason: r.reason,
    requestId: r.request_id,
  };
}

export function insertAuditRow(db: Database.Database, input: AuditRowInput): AuditRow {
  const ts = input.ts ?? Date.now();
  const info = db.prepare(
    `INSERT INTO business_metric_audit
       (ts, metric_id, action, old_value_json, new_value_json, actor_kind, actor_id, reason, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ts,
    input.metricId,
    input.action,
    input.oldValueJson ?? null,
    input.newValueJson ?? null,
    input.actorKind,
    input.actorId ?? null,
    input.reason ?? null,
    input.requestId ?? null,
  );

  return {
    id: Number(info.lastInsertRowid),
    ts,
    metricId: input.metricId,
    action: input.action,
    oldValueJson: input.oldValueJson ?? null,
    newValueJson: input.newValueJson ?? null,
    actorKind: input.actorKind,
    actorId: input.actorId ?? null,
    reason: input.reason ?? null,
    requestId: input.requestId ?? null,
  };
}

export interface ListAuditOpts {
  limit?: number;
  /** Only return rows with ts > since (epoch ms). */
  since?: number;
}

export function listAudit(
  db: Database.Database,
  metricId: string,
  opts: ListAuditOpts = {},
): AuditRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const sinceClause = opts.since ? `AND ts > ?` : '';
  const params: unknown[] = [metricId];
  if (opts.since) params.push(opts.since);
  params.push(limit);

  const rows = db.prepare(
    `SELECT id, ts, metric_id, action, old_value_json, new_value_json,
            actor_kind, actor_id, reason, request_id
       FROM business_metric_audit
      WHERE metric_id = ? ${sinceClause}
      ORDER BY ts DESC, id DESC
      LIMIT ?`,
  ).all(...params) as RawRow[];

  return rows.map(rowFromRaw);
}

/**
 * Diagnostic helper — total rows for a metric. Cheap because the
 * (metric_id, ts DESC) index covers the scan.
 */
export function countAudit(db: Database.Database, metricId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM business_metric_audit WHERE metric_id = ?`,
  ).get(metricId) as { cnt: number };
  return row.cnt;
}
