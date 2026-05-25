/**
 * Tests for the retention sweep service.
 *
 * Covers: purges rows > 7d, leaves rows < 7d, writes tombstones, idempotent.
 * Uses in-memory SQLite — no scheduler started (runRetentionSweep called directly).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';
import * as chatStore from '../src/db/chat-store.js';

// snapshot-store writes to disk — stub it out
vi.mock('../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

import { runRetentionSweep } from '../src/services/retention-sweep.js';
import { writeChatSnapshot } from '../src/db/snapshot-store.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function setDeletedAt(db: Database.Database, id: string, deletedAt: number): void {
  db.prepare('UPDATE chat_sessions SET deleted_at = ? WHERE id = ?').run(deletedAt, id);
}

describe('runRetentionSweep', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  it('hard-deletes sessions deleted > 7d ago and writes tombstones', () => {
    const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
    chatStore.appendTurn(db, {
      sessionId: session.id, turnIndex: 0, role: 'user',
      userText: 'test', startedAt: Date.now(),
    });
    // Soft-delete with timestamp 8 days ago
    setDeletedAt(db, session.id, Date.now() - 8 * 24 * 60 * 60 * 1000);

    const purged = runRetentionSweep(db);

    expect(purged).toBe(1);
    expect(chatStore.getSession(db, session.id)).toBeNull();

    // FK cascade — turns must also be gone
    const turns = chatStore.listTurns(db, session.id);
    expect(turns).toHaveLength(0);

    // Tombstone written
    const tombstone = db
      .prepare('SELECT session_id FROM chat_tombstones WHERE session_id = ?')
      .get(session.id) as { session_id: string } | undefined;
    expect(tombstone?.session_id).toBe(session.id);

    // Snapshot written once after purge
    expect(writeChatSnapshot).toHaveBeenCalledTimes(1);
  });

  it('leaves sessions deleted < 7d ago untouched', () => {
    const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
    setDeletedAt(db, session.id, Date.now() - 6 * 24 * 60 * 60 * 1000);

    const purged = runRetentionSweep(db);

    expect(purged).toBe(0);
    expect(chatStore.getSession(db, session.id)).not.toBeNull();
    expect(writeChatSnapshot).not.toHaveBeenCalled();
  });

  it('leaves live (non-deleted) sessions untouched', () => {
    chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });

    const purged = runRetentionSweep(db);

    expect(purged).toBe(0);
    const list = chatStore.listSessions(db, { ownerId: 'o', gameId: 'g' });
    expect(list).toHaveLength(1);
  });

  it('handles mix: purges only the old ones', () => {
    const old = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
    const borderline = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
    const live = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });

    setDeletedAt(db, old.id, Date.now() - 8 * 24 * 60 * 60 * 1000);
    setDeletedAt(db, borderline.id, Date.now() - 6 * 24 * 60 * 60 * 1000);
    // live has no deleted_at

    const purged = runRetentionSweep(db);

    expect(purged).toBe(1);
    expect(chatStore.getSession(db, old.id)).toBeNull();
    expect(chatStore.getSession(db, borderline.id)).not.toBeNull();
    expect(chatStore.getSession(db, live.id)).not.toBeNull();
  });

  it('is idempotent — second call returns 0 when nothing left to purge', () => {
    const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
    setDeletedAt(db, session.id, Date.now() - 8 * 24 * 60 * 60 * 1000);

    runRetentionSweep(db);
    const second = runRetentionSweep(db);

    expect(second).toBe(0);
    // Snapshot only written once (on first call)
    expect(writeChatSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not write snapshot when nothing was purged', () => {
    runRetentionSweep(db); // empty DB
    expect(writeChatSnapshot).not.toHaveBeenCalled();
  });

  it('restoring a session before sweep cutoff rescues it from purge', () => {
    const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
    setDeletedAt(db, session.id, Date.now() - 8 * 24 * 60 * 60 * 1000);

    // Restore clears deleted_at — sweep must NOT purge it
    chatStore.restoreSession(db, session.id);
    const purged = runRetentionSweep(db);

    expect(purged).toBe(0);
    expect(chatStore.getSession(db, session.id)).not.toBeNull();
  });
});
