/**
 * Phase-05 migration — `notifications` + `monitoring_audit` tables.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS). Owned by the phase-05 monitoring
 * infra; called from `migrate.ts` in fixed order per decision C1.
 */

import type Database from 'better-sqlite3';

export function migrateMonitoring(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      read_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_owner_unread
      ON notifications(owner_id, read_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS monitoring_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_id TEXT,
      detail_json TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitoring_audit_target_at
      ON monitoring_audit(target_id, at DESC);
  `);
}
