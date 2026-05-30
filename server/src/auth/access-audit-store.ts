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
