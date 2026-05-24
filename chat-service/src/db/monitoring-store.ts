/**
 * Phase-05 monitoring store — notifications + monitoring_audit access.
 *
 * Append-only audit. Notifications are owner-scoped and indexed by
 * (owner_id, read_at IS NULL, created_at DESC) for the unread-first list.
 */

import type Database from 'better-sqlite3';

export interface NotificationRow {
  id: string;
  owner_id: string;
  kind: string;
  payload_json: string;
  read_at: number | null;
  created_at: number;
}

export interface InsertNotificationInput {
  id: string;
  ownerId: string;
  kind: string;
  payload: unknown;
  createdAt?: number;
}

export function insertNotification(
  db: Database.Database,
  input: InsertNotificationInput,
): void {
  db.prepare(
    `INSERT INTO notifications (id, owner_id, kind, payload_json, read_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(
    input.id,
    input.ownerId,
    input.kind,
    JSON.stringify(input.payload),
    input.createdAt ?? Date.now(),
  );
}

export function listNotifications(
  db: Database.Database,
  ownerId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): NotificationRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (opts.unreadOnly) {
    return db
      .prepare(
        `SELECT * FROM notifications
          WHERE owner_id = ? AND read_at IS NULL
          ORDER BY created_at DESC
          LIMIT ?`,
      )
      .all(ownerId, limit) as NotificationRow[];
  }
  return db
    .prepare(
      `SELECT * FROM notifications
        WHERE owner_id = ?
        ORDER BY (read_at IS NULL) DESC, created_at DESC
        LIMIT ?`,
    )
    .all(ownerId, limit) as NotificationRow[];
}

export function markNotificationRead(
  db: Database.Database,
  ownerId: string,
  id: string,
): boolean {
  const info = db
    .prepare(
      `UPDATE notifications SET read_at = ?
        WHERE id = ? AND owner_id = ? AND read_at IS NULL`,
    )
    .run(Date.now(), id, ownerId);
  return info.changes > 0;
}

export interface MonitoringAuditInput {
  actorId?: string;
  action: string;
  targetId?: string;
  detail?: unknown;
  at?: number;
}

export function insertMonitoringAudit(
  db: Database.Database,
  input: MonitoringAuditInput,
): void {
  db.prepare(
    `INSERT INTO monitoring_audit (actor_id, action, target_id, detail_json, at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    input.actorId ?? null,
    input.action,
    input.targetId ?? null,
    input.detail !== undefined ? JSON.stringify(input.detail) : null,
    input.at ?? Date.now(),
  );
}

export function countMonitoringAuditFor(
  db: Database.Database,
  targetId: string,
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM monitoring_audit WHERE target_id = ?`)
    .get(targetId) as { n: number };
  return row.n;
}
