/**
 * Append-only audit log for access-management mutations. Every admin write
 * records who/what/when so grant changes are traceable.
 */

import { getDb } from '../db/sqlite.js';

export interface AccessAuditEntry {
  actorEmail: string;
  action: string;
  targetEmail: string;
  detail?: unknown;
}

export function recordAccessAudit(entry: AccessAuditEntry): void {
  getDb()
    .prepare(
      `INSERT INTO access_audit (actor_email, action, target_email, detail_json, ts)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      entry.actorEmail.toLowerCase(),
      entry.action,
      entry.targetEmail.toLowerCase(),
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
      new Date().toISOString(),
    );
}

// ── Read side: audit-log viewer + "last changed by/at" ───────────────────────

export interface AccessAuditRow {
  id: number;
  actorEmail: string;
  action: string;
  targetEmail: string;
  /** Parsed detail payload; null when the row had no detail or it was malformed. */
  detail: unknown;
  ts: string;
}

export interface AccessAuditFilters {
  /** Substring (case-insensitive) match on actor_email. */
  actor?: string;
  /** Exact match on action. */
  action?: string;
  /** Substring (case-insensitive) match on target_email. */
  target?: string;
  /** Inclusive lower bound on ts (ISO). */
  from?: string;
  /** Inclusive upper bound on ts (ISO). */
  to?: string;
  /** Cap returned rows (default 200, hard max 1000). */
  limit?: number;
}

interface AuditDbRow {
  id: number;
  actor_email: string;
  action: string;
  target_email: string;
  detail_json: string | null;
  ts: string;
}

function toRow(r: AuditDbRow): AccessAuditRow {
  let detail: unknown = null;
  if (r.detail_json) {
    try {
      detail = JSON.parse(r.detail_json);
    } catch {
      detail = null; // tolerate a hand-edited/corrupt row rather than throw
    }
  }
  return {
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    targetEmail: r.target_email,
    detail,
    ts: r.ts,
  };
}

/**
 * Filtered, newest-first read over the append-only audit log. Powers the admin
 * audit-log viewer. All filters are optional and AND-combined.
 */
export function queryAccessAudit(filters: AccessAuditFilters = {}): AccessAuditRow[] {
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.actor) {
    where.push('LOWER(actor_email) LIKE ?');
    params.push(`%${filters.actor.toLowerCase()}%`);
  }
  if (filters.action) {
    where.push('action = ?');
    params.push(filters.action);
  }
  if (filters.target) {
    where.push('LOWER(target_email) LIKE ?');
    params.push(`%${filters.target.toLowerCase()}%`);
  }
  if (filters.from) {
    where.push('ts >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('ts <= ?');
    params.push(filters.to);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `SELECT id, actor_email, action, target_email, detail_json, ts
         FROM access_audit ${clause}
        ORDER BY ts DESC, id DESC
        LIMIT ?`,
    )
    .all(...params, limit) as AuditDbRow[];
  return rows.map(toRow);
}

/** The most recent audit entry targeting a user — drives "last changed by/at". */
export function latestAuditForTarget(targetEmail: string): AccessAuditRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, actor_email, action, target_email, detail_json, ts
         FROM access_audit
        WHERE LOWER(target_email) = ?
        ORDER BY ts DESC, id DESC
        LIMIT 1`,
    )
    .get(targetEmail.toLowerCase()) as AuditDbRow | undefined;
  return row ? toRow(row) : null;
}
