import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';
import * as monitoringStore from '../src/db/monitoring-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('monitoringStore', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('migrates notifications + monitoring_audit tables idempotently', () => {
    // Re-running migrate must not throw.
    expect(() => migrate(db)).not.toThrow();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('notifications','monitoring_audit')`)
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(['monitoring_audit', 'notifications']);
  });

  it('inserts and lists unread notifications newest-first', () => {
    monitoringStore.insertNotification(db, {
      id: 'n1', ownerId: 'alice', kind: 'refresh_succeeded', payload: { message: 'old' }, createdAt: 100,
    });
    monitoringStore.insertNotification(db, {
      id: 'n2', ownerId: 'alice', kind: 'refresh_failed', payload: { message: 'new' }, createdAt: 200,
    });
    monitoringStore.insertNotification(db, {
      id: 'n3', ownerId: 'bob', kind: 'refresh_succeeded', payload: {}, createdAt: 300,
    });
    const rows = monitoringStore.listNotifications(db, 'alice', { unreadOnly: true });
    expect(rows.map((r) => r.id)).toEqual(['n2', 'n1']);
  });

  it('markNotificationRead flips read_at and removes from unread', () => {
    monitoringStore.insertNotification(db, {
      id: 'n1', ownerId: 'alice', kind: 'k', payload: {}, createdAt: 1,
    });
    expect(monitoringStore.markNotificationRead(db, 'alice', 'n1')).toBe(true);
    expect(monitoringStore.markNotificationRead(db, 'alice', 'n1')).toBe(false);
    const rows = monitoringStore.listNotifications(db, 'alice', { unreadOnly: true });
    expect(rows).toHaveLength(0);
  });

  it('audit insert is append-only and queryable by target_id', () => {
    monitoringStore.insertMonitoringAudit(db, {
      actorId: 'alice', action: 'segment_pinned', targetId: 'seg-1', detail: { foo: 'bar' },
    });
    monitoringStore.insertMonitoringAudit(db, {
      actorId: 'scheduler', action: 'refresh_succeeded', targetId: 'seg-1', detail: { ms: 200 },
    });
    expect(monitoringStore.countMonitoringAuditFor(db, 'seg-1')).toBe(2);
    expect(monitoringStore.countMonitoringAuditFor(db, 'seg-2')).toBe(0);
  });
});
