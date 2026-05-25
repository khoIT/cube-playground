/**
 * Unit tests for annotations-store.ts.
 *
 * Covers: upsert creates, upsert merges, delete, FK cascade on turn delete.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import * as annotationsStore from '../../src/db/annotations-store.js';
import * as chatStore from '../../src/db/chat-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function seedTurn(db: Database.Database, ownerId = 'owner-1', gameId = 'g1') {
  const session = chatStore.createSession(db, { ownerId, gameId, title: 'test' });
  const turnId = 'turn-' + Math.random().toString(36).slice(2);
  db.prepare(
    `INSERT INTO chat_turns (id, session_id, turn_index, role, started_at) VALUES (?, ?, 0, 'user', ?)`,
  ).run(turnId, session.id, Date.now());
  return { session, turnId };
}

describe('annotations-store', () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });

  it('upsert creates a new row with defaults', () => {
    const { turnId } = seedTurn(db);
    const row = annotationsStore.upsertAnnotation(db, turnId, 'owner-1', { starred: true });
    expect(row.turn_id).toBe(turnId);
    expect(row.starred).toBe(1);
    expect(row.flag).toBeNull();
    expect(row.note).toBeNull();
    expect(row.updated_at).toBeGreaterThan(0);
  });

  it('upsert merges into existing row without clobbering unset fields', () => {
    const { turnId } = seedTurn(db);
    annotationsStore.upsertAnnotation(db, turnId, 'owner-1', { starred: true, flag: 'bug' });
    // Only update note — starred and flag should be preserved
    const updated = annotationsStore.upsertAnnotation(db, turnId, 'owner-1', { note: 'check this' });
    expect(updated.starred).toBe(1);
    expect(updated.flag).toBe('bug');
    expect(updated.note).toBe('check this');
  });

  it('upsert caps note at 1024 chars', () => {
    const { turnId } = seedTurn(db);
    const longNote = 'x'.repeat(2000);
    const row = annotationsStore.upsertAnnotation(db, turnId, 'owner-1', { note: longNote });
    expect(row.note!.length).toBe(1024);
  });

  it('getAnnotation returns null when no row exists', () => {
    const { turnId } = seedTurn(db);
    expect(annotationsStore.getAnnotation(db, turnId, 'owner-1')).toBeNull();
  });

  it('getAnnotation is owner-scoped', () => {
    const { turnId } = seedTurn(db, 'owner-1');
    annotationsStore.upsertAnnotation(db, turnId, 'owner-1', { starred: true });
    expect(annotationsStore.getAnnotation(db, turnId, 'owner-2')).toBeNull();
  });

  it('deleteAnnotation removes the row', () => {
    const { turnId } = seedTurn(db);
    annotationsStore.upsertAnnotation(db, turnId, 'owner-1', { starred: true });
    annotationsStore.deleteAnnotation(db, turnId, 'owner-1');
    expect(annotationsStore.getAnnotation(db, turnId, 'owner-1')).toBeNull();
  });

  it('deleteAnnotation is a no-op when row does not exist', () => {
    const { turnId } = seedTurn(db);
    expect(() => annotationsStore.deleteAnnotation(db, turnId, 'owner-1')).not.toThrow();
  });

  it('FK cascade: deleting the turn removes the annotation', () => {
    const { session, turnId } = seedTurn(db);
    annotationsStore.upsertAnnotation(db, turnId, 'owner-1', { starred: true });

    // Hard-delete the session which cascades to turns → annotations
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(session.id);

    // Turn should be gone
    const turn = db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(turnId);
    expect(turn).toBeUndefined();

    // Annotation should be gone too (FK ON DELETE CASCADE)
    const annotation = db.prepare('SELECT * FROM turn_annotations WHERE turn_id = ?').get(turnId);
    expect(annotation).toBeUndefined();
  });

  it('FK cascade: deleting only the turn row removes annotation', () => {
    const { turnId } = seedTurn(db);
    annotationsStore.upsertAnnotation(db, turnId, 'owner-1', { flag: 'important' });
    db.prepare('DELETE FROM chat_turns WHERE id = ?').run(turnId);
    const annotation = db.prepare('SELECT * FROM turn_annotations WHERE turn_id = ?').get(turnId);
    expect(annotation).toBeUndefined();
  });
});
