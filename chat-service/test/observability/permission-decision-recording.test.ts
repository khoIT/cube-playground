/**
 * permission-decision-recording.test.ts — Phase-02
 *
 * Tests for LlmTraceRecorder.onPermissionDecision INSERT path and
 * idempotency on duplicate ids (INSERT OR IGNORE).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LlmTraceRecorder } from '../../src/observability/llm-trace-recorder.js';
import { migrate } from '../../src/db/migrate.js';
import type { PermissionDecisionEvent } from '../../src/observability/observer-types.js';
import { listPermissionDecisionsByTurn } from '../../src/db/observability-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('LlmTraceRecorder.onPermissionDecision', () => {
  let db: Database.Database;
  let recorder: LlmTraceRecorder;
  const turnId = 'turn-perm-1';

  beforeEach(() => {
    db = makeDb();
    // Insert required chat_sessions + chat_turns FK parents
    db.prepare("INSERT INTO chat_sessions (id, owner_id, game_id, title, created_at, status) VALUES (?, ?, ?, ?, ?, ?)")
      .run('session-1', 'owner-1', 'game-1', 'test', Date.now(), 'active');
    db.prepare("INSERT INTO chat_turns (id, session_id, turn_index, role, started_at) VALUES (?, ?, ?, ?, ?)")
      .run(turnId, 'session-1', 0, 'assistant', Date.now());
    recorder = new LlmTraceRecorder({ db, turnId });
  });

  it('inserts a permission decision row', () => {
    const ev: PermissionDecisionEvent = {
      id: 'pd-001',
      turnId,
      toolName: 'Bash',
      decision: 'denied',
      reason: 'Tool not in allowed list',
      at: 1_000_000,
    };
    recorder.onPermissionDecision(ev);

    const rows = listPermissionDecisionsByTurn(db, turnId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('pd-001');
    expect(rows[0].tool_name).toBe('Bash');
    expect(rows[0].decision).toBe('denied');
    expect(rows[0].reason).toBe('Tool not in allowed list');
    expect(rows[0].at).toBe(1_000_000);
  });

  it('is idempotent on duplicate id (INSERT OR IGNORE)', () => {
    const ev: PermissionDecisionEvent = {
      id: 'pd-dup',
      turnId,
      toolName: 'Write',
      decision: 'denied',
      reason: null,
      at: 2_000_000,
    };
    recorder.onPermissionDecision(ev);
    recorder.onPermissionDecision(ev); // second call must not throw or duplicate

    const rows = listPermissionDecisionsByTurn(db, turnId);
    expect(rows).toHaveLength(1);
  });

  it('stores null reason without error', () => {
    const ev: PermissionDecisionEvent = {
      id: 'pd-null-reason',
      turnId,
      toolName: 'Read',
      decision: 'denied',
      reason: null,
      at: Date.now(),
    };
    recorder.onPermissionDecision(ev);

    const rows = listPermissionDecisionsByTurn(db, turnId);
    expect(rows[0].reason).toBeNull();
  });

  it('swallows FK violation (missing turn row) without throwing', () => {
    const badRecorder = new LlmTraceRecorder({ db, turnId: 'nonexistent-turn' });
    expect(() => badRecorder.onPermissionDecision({
      id: 'pd-bad',
      turnId: 'nonexistent-turn',
      toolName: 'Bash',
      decision: 'denied',
      reason: null,
      at: Date.now(),
    })).not.toThrow();
  });
});
