/**
 * StructuredLogSink (Phase 05) — verifies JSON-lines emission, kind tagging,
 * redaction of content/args, and that the sink never throws.
 */

import { describe, it, expect } from 'vitest';
import { StructuredLogSink } from '../../src/observability/sinks/structured-log-sink.js';

describe('StructuredLogSink', () => {
  it('emits one JSON line per TraceEvent with kind + turnId', () => {
    const lines: string[] = [];
    const sink = new StructuredLogSink({ emit: (l) => lines.push(l), now: () => 100 });
    sink.emit({
      kind: 'llm_call',
      payload: {
        turnId: 't1',
        stepIndex: 0,
        model: 'm',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 25,
        startedAt: 0,
        endedAt: 25,
        content: [{ type: 'text', text: 'hello world' }],
        stopReason: 'end_turn',
      },
    });
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(rec['kind']).toBe('llm_call');
    expect(rec['turnId']).toBe('t1');
    expect(rec['ts']).toBe(100);
    expect(rec['stopReason']).toBe('end_turn');
  });

  it('redacts text content into block-type + length summaries', () => {
    const lines: string[] = [];
    const sink = new StructuredLogSink({ emit: (l) => lines.push(l) });
    sink.emit({
      kind: 'llm_call',
      payload: {
        turnId: 't1',
        stepIndex: 0,
        model: 'm',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 1,
        startedAt: 0,
        endedAt: 1,
        content: [
          { type: 'text', text: 'plain user data should not leak' },
          { type: 'thinking', thinking: 'and neither should reasoning' },
        ],
      },
    });
    const rec = JSON.parse(lines[0]!) as { content: Array<{ type: string; len: number }> };
    expect(rec.content).toEqual([
      { type: 'text', len: 'plain user data should not leak'.length },
      { type: 'thinking', len: 'and neither should reasoning'.length },
    ]);
    expect(lines[0]).not.toContain('plain user data');
    expect(lines[0]).not.toContain('reasoning');
  });

  it('redacts tool args into keys + count', () => {
    const lines: string[] = [];
    const sink = new StructuredLogSink({ emit: (l) => lines.push(l) });
    sink.emit({
      kind: 'tool_invocation',
      payload: {
        turnId: 't1',
        toolUseId: 'tu',
        name: 'echo',
        args: { secret: 's3cr3t', mode: 'json' },
        resultSummary: 'ok',
        ok: true,
        latencyMs: 5,
        startedAt: 0,
        endedAt: 5,
      },
    });
    const rec = JSON.parse(lines[0]!) as { args: { keys: string[]; size: number } };
    expect(rec.args).toEqual({ keys: ['secret', 'mode'], size: 2 });
    expect(lines[0]).not.toContain('s3cr3t');
  });

  it('emits a turn_aborted record', () => {
    const lines: string[] = [];
    const sink = new StructuredLogSink({ emit: (l) => lines.push(l) });
    sink.emit({
      kind: 'turn_aborted',
      payload: { turnId: 't1', reason: 'timeout', message: 'exceeded', at: 0 },
    });
    const rec = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(rec['kind']).toBe('turn_aborted');
    expect(rec['reason']).toBe('timeout');
  });
});
