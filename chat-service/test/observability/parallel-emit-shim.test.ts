/**
 * Parallel-emit shim (Phase 05) — proves the diff machinery and, end-to-end,
 * that the legacy inline dispatch and the TurnTracer produce a structurally
 * identical observer-callback sequence on the same SDK message stream.
 *
 * The "legacy driver" below replicates claude-runner.ts's per-message emit
 * order exactly (sdk_event always; llm_call on assistant; tool_invocation on
 * user; turn_finalized on result; flush after the loop) so the test compares
 * the real legacy logic against the tracer — not a re-derivation of the tracer.
 */

import { describe, it, expect } from 'vitest';
import {
  RecordingObserver,
  RecordingSink,
  diffRecordings,
} from '../../src/observability/parallel-emit-shim.js';
import { TurnTracer } from '../../src/observability/turn-tracer.js';
import {
  emitSdkEvent,
  emitLlmCall,
  emitToolInvocations,
  emitTurnFinalized,
  flushPendingTools,
  type PendingTool,
} from '../../src/observability/sdk-event-extractor.js';

const MODEL = 'claude-sonnet-4-6';

function asstMsg(blocks: Array<Record<string, unknown>>) {
  return { type: 'assistant', message: { content: blocks } };
}
function toolResultMsg(toolUseId: string) {
  return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] } };
}
function resultMsg(stop_reason = 'end_turn') {
  return { type: 'result', stop_reason, usage: { input_tokens: 10, output_tokens: 20 }, permission_denials: [] };
}

/** Mirror of the runner's inline legacy dispatch, recording into observer. */
function driveLegacy(observer: RecordingObserver, turnId: string, msgs: unknown[]): void {
  let stepIndex = 0;
  let seq = 0;
  let lastBoundary = Date.now();
  const pending = new Map<string, PendingTool>();
  for (const msg of msgs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any;
    emitSdkEvent(observer, turnId, seq++, m);
    if (m.type === 'assistant') {
      lastBoundary = emitLlmCall(observer, turnId, stepIndex++, MODEL, lastBoundary, m, pending);
    } else if (m.type === 'user') {
      emitToolInvocations(observer, turnId, m, pending);
    } else if (m.type === 'result') {
      emitTurnFinalized(observer, turnId, m);
    }
  }
  if (pending.size > 0) flushPendingTools(observer, turnId, pending);
}

function driveTracer(sink: RecordingSink, turnId: string, msgs: unknown[]): void {
  const tracer = new TurnTracer({ turnId, sessionId: 's1', model: MODEL, sinks: [sink] });
  for (const msg of msgs) tracer.onSdkMessage(msg);
  tracer.finalize();
}

describe('parallel-emit shim diff', () => {
  const turnId = 't1';
  const stream = [
    { type: 'system' },
    asstMsg([{ type: 'text', text: 'let me check' }, { type: 'tool_use', id: 'tu_1', name: 'preview_cube_query', input: { q: 'revenue' } }]),
    toolResultMsg('tu_1'),
    asstMsg([{ type: 'text', text: 'here is the answer' }]),
    resultMsg('end_turn'),
  ];

  it('reports a byte-identical match for legacy vs tracer on the same stream', () => {
    const legacy = new RecordingObserver();
    const sink = new RecordingSink();
    driveLegacy(legacy, turnId, stream);
    driveTracer(sink, turnId, stream);

    const diff = diffRecordings(legacy.events, sink.events);
    expect(diff.match).toBe(true);
    expect(diff.mismatches).toHaveLength(0);
    expect(diff.legacyCount).toBe(diff.shadowCount);
    // sdk_event per message (5) + 2 llm_call + 1 tool_invocation + 1 turn_finalized
    expect(diff.kindCounts['sdk_event']).toBe(5);
    expect(diff.kindCounts['llm_call']).toBe(2);
    expect(diff.kindCounts['tool_invocation']).toBe(1);
    expect(diff.kindCounts['turn_finalized']).toBe(1);
  });

  it('flushes an abandoned tool_use identically in both paths', () => {
    const abandoned = [
      asstMsg([{ type: 'tool_use', id: 'tu_x', name: 'get_cube_meta', input: {} }]),
      resultMsg('end_turn'),
    ];
    const legacy = new RecordingObserver();
    const sink = new RecordingSink();
    driveLegacy(legacy, turnId, abandoned);
    driveTracer(sink, turnId, abandoned);
    const diff = diffRecordings(legacy.events, sink.events);
    expect(diff.match).toBe(true);
    // the abandoned tool surfaces as a tool_invocation with ok:false
    const flushed = sink.events.find((e) => e.kind === 'tool_invocation');
    expect(flushed?.payload['ok']).toBe(false);
  });

  it('ignores latency/timestamp/uuid fields when comparing', () => {
    const legacy = [{ kind: 'llm_call' as const, payload: { turnId, stepIndex: 0, content: [], latencyMs: 5, startedAt: 100, endedAt: 105 } }];
    const shadow = [{ kind: 'llm_call' as const, payload: { turnId, stepIndex: 0, content: [], latencyMs: 9, startedAt: 200, endedAt: 209 } }];
    const diff = diffRecordings(legacy, shadow);
    expect(diff.match).toBe(true);
    expect(diff.maxLatencyDeltaMs).toBe(4);
  });

  it('flags a real structural divergence (different stepIndex)', () => {
    const legacy = [{ kind: 'llm_call' as const, payload: { turnId, stepIndex: 0, content: [] } }];
    const shadow = [{ kind: 'llm_call' as const, payload: { turnId, stepIndex: 1, content: [] } }];
    const diff = diffRecordings(legacy, shadow);
    expect(diff.match).toBe(false);
    expect(diff.mismatches[0].reason).toBe('payload');
  });

  it('flags a dropped event (length mismatch)', () => {
    const legacy = [
      { kind: 'sdk_event' as const, payload: { turnId, seq: 0, type: 'system' } },
      { kind: 'sdk_event' as const, payload: { turnId, seq: 1, type: 'result' } },
    ];
    const shadow = [{ kind: 'sdk_event' as const, payload: { turnId, seq: 0, type: 'system' } }];
    const diff = diffRecordings(legacy, shadow);
    expect(diff.match).toBe(false);
    expect(diff.mismatches[0].reason).toBe('missing_in_shadow');
  });
});
