/**
 * llm-trace-recorder.test.ts — Tests for the SQLite-backed observer.
 *
 * Uses :memory: SQLite via better-sqlite3 and the actual migrations.
 * Validates roundtrip writes/reads, idempotency, truncation, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LlmTraceRecorder, BufferedLlmTraceRecorder } from '../../src/observability/llm-trace-recorder.js';
import { migrateObservability } from '../../src/db/observability-migrate.js';
import type { LlmCallEvent, ToolInvocationEvent, SdkEventRecord } from '../../src/observability/observer-types.js';
import { insertLlmCall, insertToolInvocation, insertSdkEvent } from '../../src/db/observability-store.js';

describe('LlmTraceRecorder', () => {
  let db: Database.Database;
  let recorder: LlmTraceRecorder;
  const turnId = 'turn-test-1';

  beforeEach(() => {
    // Create in-memory DB with minimal schema (just the observability tables)
    db = new Database(':memory:');

    // Create chat_turns table (referenced by FK)
    db.exec(`
      CREATE TABLE chat_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
      );
    `);

    // Insert the test turn
    db.prepare('INSERT INTO chat_turns (id, session_id) VALUES (?, ?)')
      .run(turnId, 'session-1');

    // Run the observability migration
    migrateObservability(db);

    // Create a recorder for this turn
    recorder = new LlmTraceRecorder({ db, turnId });
  });

  describe('roundtrip', () => {
    it('writes and reads back LLM calls exactly', () => {
      const event: LlmCallEvent = {
        turnId,
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1234,
        startedAt: 1000,
        endedAt: 2234,
        content: [{ type: 'text', text: 'hello' }],
        stopReason: 'end_turn',
      };

      recorder.onLlmCall(event);

      const rows = db
        .prepare('SELECT * FROM llm_calls WHERE turn_id = ? ORDER BY step_index')
        .all(turnId) as any[];

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.step_index).toBe(0);
      expect(row.model).toBe('claude-3-5-sonnet');
      expect(row.input_tokens).toBe(100);
      expect(row.output_tokens).toBe(200);
      expect(row.latency_ms).toBe(1234);
      expect(row.started_at).toBe(1000);
      expect(row.ended_at).toBe(2234);
      expect(row.content_json).toBe(JSON.stringify(event.content));
      expect(row.stop_reason).toBe('end_turn');
    });

    it('writes and reads back tool invocations exactly', () => {
      const event: ToolInvocationEvent = {
        turnId,
        toolUseId: 'tool-use-1',
        name: 'test_tool',
        args: { query: 'SELECT * FROM events' },
        resultSummary: 'Query executed successfully',
        ok: true,
        latencyMs: 500,
        startedAt: 1000,
        endedAt: 1500,
      };

      recorder.onToolInvocation(event);

      const rows = db
        .prepare('SELECT * FROM tool_invocations WHERE turn_id = ? ORDER BY tool_use_id')
        .all(turnId) as any[];

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.tool_use_id).toBe('tool-use-1');
      expect(row.name).toBe('test_tool');
      expect(row.args_json).toBe(JSON.stringify(event.args));
      expect(row.result_summary).toBe('Query executed successfully');
      expect(row.ok).toBe(1);
      expect(row.latency_ms).toBe(500);
      expect(row.started_at).toBe(1000);
      expect(row.ended_at).toBe(1500);
    });

    it('writes and reads back SDK events exactly', () => {
      const event: SdkEventRecord = {
        turnId,
        seq: 0,
        type: 'message_start',
        payload: { type: 'message_start', message: { role: 'assistant' } },
        at: 1000,
      };

      recorder.onSdkEvent(event);

      const rows = db
        .prepare('SELECT * FROM sdk_events WHERE turn_id = ? ORDER BY seq')
        .all(turnId) as any[];

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.seq).toBe(0);
      expect(row.type).toBe('message_start');
      expect(row.payload_json).toBe(JSON.stringify(event.payload));
      expect(row.at).toBe(1000);
    });

    it('stores multiple events of mixed types', () => {
      const llmEvent1: LlmCallEvent = {
        turnId,
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      };

      const llmEvent2: LlmCallEvent = {
        turnId,
        stepIndex: 1,
        model: 'claude-3-5-sonnet',
        inputTokens: 50,
        outputTokens: 100,
        latencyMs: 500,
        startedAt: 2000,
        endedAt: 2500,
        content: [],
      };

      const toolEvent: ToolInvocationEvent = {
        turnId,
        toolUseId: 'tool-use-1',
        name: 'test_tool',
        args: {},
        resultSummary: 'ok',
        ok: true,
        latencyMs: 200,
        startedAt: 1500,
        endedAt: 1700,
      };

      const sdkEvent1: SdkEventRecord = {
        turnId,
        seq: 0,
        type: 'message_start',
        payload: {},
        at: 1000,
      };

      const sdkEvent2: SdkEventRecord = {
        turnId,
        seq: 1,
        type: 'content_block_start',
        payload: {},
        at: 1100,
      };

      recorder.onLlmCall(llmEvent1);
      recorder.onLlmCall(llmEvent2);
      recorder.onToolInvocation(toolEvent);
      recorder.onSdkEvent(sdkEvent1);
      recorder.onSdkEvent(sdkEvent2);

      const llmRows = db
        .prepare('SELECT COUNT(*) as cnt FROM llm_calls WHERE turn_id = ?')
        .get(turnId) as any;
      const toolRows = db
        .prepare('SELECT COUNT(*) as cnt FROM tool_invocations WHERE turn_id = ?')
        .get(turnId) as any;
      const sdkRows = db
        .prepare('SELECT COUNT(*) as cnt FROM sdk_events WHERE turn_id = ?')
        .get(turnId) as any;

      expect(llmRows.cnt).toBe(2);
      expect(toolRows.cnt).toBe(1);
      expect(sdkRows.cnt).toBe(2);
    });
  });

  describe('idempotency', () => {
    it('LLM calls are idempotent on (turn_id, step_index)', () => {
      const event: LlmCallEvent = {
        turnId,
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      };

      // Write twice
      recorder.onLlmCall(event);
      recorder.onLlmCall(event);

      const rows = db
        .prepare('SELECT COUNT(*) as cnt FROM llm_calls WHERE turn_id = ?')
        .get(turnId) as any;

      expect(rows.cnt).toBe(1);
    });

    it('tool invocations are idempotent on (turn_id, tool_use_id)', () => {
      const event: ToolInvocationEvent = {
        turnId,
        toolUseId: 'tool-use-1',
        name: 'test_tool',
        args: {},
        resultSummary: 'ok',
        ok: true,
        latencyMs: 200,
        startedAt: 1000,
        endedAt: 1200,
      };

      // Write twice
      recorder.onToolInvocation(event);
      recorder.onToolInvocation(event);

      const rows = db
        .prepare('SELECT COUNT(*) as cnt FROM tool_invocations WHERE turn_id = ?')
        .get(turnId) as any;

      expect(rows.cnt).toBe(1);
    });

    it('SDK events are NOT idempotent (append-only)', () => {
      const event: SdkEventRecord = {
        turnId,
        seq: 0,
        type: 'message_start',
        payload: {},
        at: 1000,
      };

      // Write twice
      recorder.onSdkEvent(event);
      recorder.onSdkEvent(event);

      const rows = db
        .prepare('SELECT COUNT(*) as cnt FROM sdk_events WHERE turn_id = ?')
        .get(turnId) as any;

      // Both should be stored (append-only)
      expect(rows.cnt).toBe(2);
    });
  });

  describe('truncation', () => {
    it('truncates content_json to 64 KB', () => {
      const largeContent = 'x'.repeat(70 * 1024); // 70 KB
      const event: LlmCallEvent = {
        turnId,
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        startedAt: 0,
        endedAt: 0,
        content: largeContent,
      };

      recorder.onLlmCall(event);

      const row = db
        .prepare('SELECT content_json FROM llm_calls WHERE turn_id = ?')
        .get(turnId) as any;

      expect(row.content_json).toBeTruthy();
      // Should be <= 64KB
      expect(row.content_json!.length).toBeLessThanOrEqual(64 * 1024);
      // Should end with [truncated]
      expect(row.content_json).toMatch(/\[truncated\]$/);
    });

    it('truncates result_summary to 4 KB', () => {
      const largeSummary = 'x'.repeat(5 * 1024); // 5 KB
      const event: ToolInvocationEvent = {
        turnId,
        toolUseId: 'tool-use-1',
        name: 'test_tool',
        args: {},
        resultSummary: largeSummary,
        ok: true,
        latencyMs: 0,
        startedAt: 0,
        endedAt: 0,
      };

      recorder.onToolInvocation(event);

      const row = db
        .prepare('SELECT result_summary FROM tool_invocations WHERE turn_id = ?')
        .get(turnId) as any;

      expect(row.result_summary).toBeTruthy();
      // Should be <= 4KB
      expect(row.result_summary!.length).toBeLessThanOrEqual(4 * 1024);
      // Should end with [truncated]
      expect(row.result_summary).toMatch(/\[truncated\]$/);
    });

    it('truncates payload_json to 64 KB', () => {
      const largePayload = { data: 'y'.repeat(70 * 1024) };
      const event: SdkEventRecord = {
        turnId,
        seq: 0,
        type: 'content_block_delta',
        payload: largePayload,
        at: Date.now(),
      };

      recorder.onSdkEvent(event);

      const row = db
        .prepare('SELECT payload_json FROM sdk_events WHERE turn_id = ?')
        .get(turnId) as any;

      expect(row.payload_json).toBeTruthy();
      // Should be <= 64KB
      expect(row.payload_json!.length).toBeLessThanOrEqual(64 * 1024);
      // Should end with [truncated]
      expect(row.payload_json).toMatch(/\[truncated\]$/);
    });
  });

  describe('error handling', () => {
    it('swallows DB errors and does not throw', () => {
      // Drop the llm_calls table to cause a future insert to fail
      db.exec('DROP TABLE llm_calls');

      const event: LlmCallEvent = {
        turnId,
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      };

      // Should not throw
      expect(() => recorder.onLlmCall(event)).not.toThrow();
    });

    it('swallows tool invocation insert errors', () => {
      // Drop the tool_invocations table
      db.exec('DROP TABLE tool_invocations');

      const event: ToolInvocationEvent = {
        turnId,
        toolUseId: 'tool-use-1',
        name: 'test_tool',
        args: {},
        resultSummary: 'ok',
        ok: true,
        latencyMs: 200,
        startedAt: 1000,
        endedAt: 1200,
      };

      expect(() => recorder.onToolInvocation(event)).not.toThrow();
    });

    it('swallows SDK event insert errors', () => {
      // Drop the sdk_events table
      db.exec('DROP TABLE sdk_events');

      const event: SdkEventRecord = {
        turnId,
        seq: 0,
        type: 'message_start',
        payload: {},
        at: Date.now(),
      };

      expect(() => recorder.onSdkEvent(event)).not.toThrow();
    });
  });

  describe('null handling', () => {
    it('accepts null/undefined for optional fields', () => {
      const event: LlmCallEvent = {
        turnId,
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: undefined as any,
        outputTokens: undefined as any,
        latencyMs: 0,
        startedAt: 0,
        endedAt: 0,
        content: [],
      };

      recorder.onLlmCall(event);

      const row = db
        .prepare('SELECT input_tokens, output_tokens FROM llm_calls WHERE turn_id = ?')
        .get(turnId) as any;

      expect(row.input_tokens).toBeNull();
      expect(row.output_tokens).toBeNull();
    });
  });
});

describe('BufferedLlmTraceRecorder', () => {
  let db: Database.Database;
  const turnId = 'turn-buffered-1';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE chat_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
      );
    `);
    migrateObservability(db);
  });

  it('buffers events while chat_turns row is missing (FK would reject)', () => {
    // Turn row does NOT exist yet — direct writes via inner recorder would
    // hit FOREIGN KEY constraint failed.
    const buffered = new BufferedLlmTraceRecorder(new LlmTraceRecorder({ db, turnId }));

    buffered.onSdkEvent({ turnId, seq: 0, type: 'assistant', payload: {}, at: 1 });
    buffered.onLlmCall({ turnId, stepIndex: 0, model: 'm', inputTokens: 0, outputTokens: 0, latencyMs: 1, startedAt: 0, endedAt: 1, content: [] });
    buffered.onToolInvocation({ turnId, toolUseId: 'tu-1', name: 't', args: {}, resultSummary: 'ok', ok: true, latencyMs: 1, startedAt: 0, endedAt: 1 });

    // No rows yet
    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tool_invocations').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sdk_events').get()).toEqual({ n: 0 });

    // Now satisfy the FK and flush
    db.prepare('INSERT INTO chat_turns (id, session_id) VALUES (?, ?)').run(turnId, 's-1');
    buffered.flush();

    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tool_invocations').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sdk_events').get()).toEqual({ n: 1 });
  });

  it('without flush, no rows land even after FK is satisfied', () => {
    const buffered = new BufferedLlmTraceRecorder(new LlmTraceRecorder({ db, turnId }));
    buffered.onLlmCall({ turnId, stepIndex: 0, model: 'm', inputTokens: 0, outputTokens: 0, latencyMs: 1, startedAt: 0, endedAt: 1, content: [] });
    db.prepare('INSERT INTO chat_turns (id, session_id) VALUES (?, ?)').run(turnId, 's-1');
    // No flush call
    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 0 });
  });

  it('flush is idempotent (second flush is a no-op)', () => {
    const buffered = new BufferedLlmTraceRecorder(new LlmTraceRecorder({ db, turnId }));
    buffered.onLlmCall({ turnId, stepIndex: 0, model: 'm', inputTokens: 0, outputTokens: 0, latencyMs: 1, startedAt: 0, endedAt: 1, content: [] });
    db.prepare('INSERT INTO chat_turns (id, session_id) VALUES (?, ?)').run(turnId, 's-1');
    buffered.flush();
    buffered.flush();
    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 1 });
  });
});
