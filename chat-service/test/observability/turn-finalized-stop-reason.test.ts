/**
 * turn-finalized-stop-reason.test.ts — Phase-02
 *
 * Tests for LlmTraceRecorder.onTurnFinalized UPDATE path:
 *   - writes stop_reason to chat_turns row
 *   - null stopReason is a no-op (UPDATE skipped)
 *   - emitTurnFinalized extracts stop_reason from result SDK message shape
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LlmTraceRecorder } from '../../src/observability/llm-trace-recorder.js';
import { emitTurnFinalized } from '../../src/observability/sdk-event-extractor.js';
import { migrate } from '../../src/db/migrate.js';
import type { TurnFinalizedEvent } from '../../src/observability/observer-types.js';
import type { ObserverHooks } from '../../src/observability/observer-types.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function getTurnStopReason(db: Database.Database, turnId: string): string | null {
  const row = db.prepare('SELECT stop_reason FROM chat_turns WHERE id = ?').get(turnId) as
    | { stop_reason: string | null }
    | undefined;
  return row?.stop_reason ?? null;
}

describe('LlmTraceRecorder.onTurnFinalized', () => {
  let db: Database.Database;
  let recorder: LlmTraceRecorder;
  const turnId = 'turn-finalized-1';

  beforeEach(() => {
    db = makeDb();
    db.prepare("INSERT INTO chat_sessions (id, owner_id, game_id, title, created_at, status) VALUES (?, ?, ?, ?, ?, ?)")
      .run('session-1', 'owner-1', 'game-1', 'test', Date.now(), 'active');
    db.prepare("INSERT INTO chat_turns (id, session_id, turn_index, role, started_at) VALUES (?, ?, ?, ?, ?)")
      .run(turnId, 'session-1', 0, 'assistant', Date.now());
    recorder = new LlmTraceRecorder({ db, turnId });
  });

  it('writes stop_reason to chat_turns', () => {
    const ev: TurnFinalizedEvent = {
      turnId,
      stopReason: 'end_turn',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      at: Date.now(),
    };
    recorder.onTurnFinalized(ev);
    expect(getTurnStopReason(db, turnId)).toBe('end_turn');
  });

  it('writes tool_use stop_reason', () => {
    recorder.onTurnFinalized({ turnId, stopReason: 'tool_use', totalInputTokens: 0, totalOutputTokens: 0, at: Date.now() });
    expect(getTurnStopReason(db, turnId)).toBe('tool_use');
  });

  it('skips UPDATE when stopReason is null', () => {
    // Pre-set a stop_reason, then call with null — must not overwrite
    db.prepare('UPDATE chat_turns SET stop_reason = ? WHERE id = ?').run('end_turn', turnId);
    recorder.onTurnFinalized({ turnId, stopReason: null, totalInputTokens: 0, totalOutputTokens: 0, at: Date.now() });
    expect(getTurnStopReason(db, turnId)).toBe('end_turn'); // unchanged
  });

  it('does not throw when turn row is missing', () => {
    const badRecorder = new LlmTraceRecorder({ db, turnId: 'nonexistent' });
    expect(() => badRecorder.onTurnFinalized({
      turnId: 'nonexistent', stopReason: 'end_turn',
      totalInputTokens: 0, totalOutputTokens: 0, at: Date.now(),
    })).not.toThrow();
  });
});

describe('emitTurnFinalized (sdk-event-extractor)', () => {
  it('extracts stop_reason from result message and calls onTurnFinalized', () => {
    const captured: TurnFinalizedEvent[] = [];
    const observer: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: () => {},
      onSdkEvent: () => {},
      onTurnFinalized: (ev) => captured.push(ev),
    };

    const resultMsg = {
      type: 'result',
      stop_reason: 'end_turn',
      permission_denials: [],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 },
    };

    emitTurnFinalized(observer, 'turn-x', resultMsg);

    expect(captured).toHaveLength(1);
    expect(captured[0].stopReason).toBe('end_turn');
    expect(captured[0].totalInputTokens).toBe(18); // 10+5+3
    expect(captured[0].totalOutputTokens).toBe(20);
  });

  it('returns null stopReason when result message has no stop_reason field', () => {
    const captured: TurnFinalizedEvent[] = [];
    const observer: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: () => {},
      onSdkEvent: () => {},
      onTurnFinalized: (ev) => captured.push(ev),
    };

    emitTurnFinalized(observer, 'turn-y', { type: 'result', permission_denials: [] });

    expect(captured[0].stopReason).toBeNull();
  });

  it('emits onPermissionDecision for each denial in permission_denials', () => {
    const decisions: Array<{ toolName: string; decision: string }> = [];
    const observer: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: () => {},
      onSdkEvent: () => {},
      onTurnFinalized: () => {},
      onPermissionDecision: (ev) => decisions.push({ toolName: ev.toolName, decision: ev.decision }),
    };

    const resultMsg = {
      type: 'result',
      stop_reason: 'end_turn',
      permission_denials: [
        { toolName: 'Bash', decision: 'denied', reason: 'not allowed' },
        { toolName: 'Write', decision: 'denied', reason: null },
      ],
    };

    emitTurnFinalized(observer, 'turn-z', resultMsg);

    expect(decisions).toHaveLength(2);
    expect(decisions[0].toolName).toBe('Bash');
    expect(decisions[1].toolName).toBe('Write');
  });

  it('is a no-op when observer has no onTurnFinalized hook', () => {
    const observer: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: () => {},
      onSdkEvent: () => {},
      // onTurnFinalized intentionally absent
    };
    expect(() => emitTurnFinalized(observer, 'turn-noop', { type: 'result', stop_reason: 'end_turn' })).not.toThrow();
  });
});
