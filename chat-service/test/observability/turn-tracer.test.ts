/**
 * TurnTracer (Phase 05) — verifies that an SDK message firehose flowing
 * through `onSdkMessage` produces the same TraceEvent shape and sequence as
 * the legacy ObserverHooks call chain, and that sink failures are isolated.
 */

import { describe, it, expect } from 'vitest';
import { TurnTracer } from '../../src/observability/turn-tracer.js';
import type { TraceEvent, TraceSink } from '../../src/observability/trace-event.js';

class RecordingSink implements TraceSink {
  readonly name = 'recording';
  readonly events: TraceEvent[] = [];
  emit(event: TraceEvent): void {
    this.events.push(event);
  }
}

class ThrowingSink implements TraceSink {
  readonly name = 'throwing';
  emit(): void {
    throw new Error('boom');
  }
}

function asstMsg(blocks: Array<Record<string, unknown>>) {
  return { type: 'assistant', message: { content: blocks } };
}

function toolResultMsg(toolUseId: string) {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] },
  };
}

function resultMsg(stop_reason = 'end_turn') {
  return {
    type: 'result',
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 20 },
    permission_denials: [],
  };
}

describe('TurnTracer', () => {
  it('fans an assistant→user→result sequence into typed TraceEvents', () => {
    const sink = new RecordingSink();
    const tracer = new TurnTracer({
      turnId: 't1',
      sessionId: 's1',
      model: 'claude-test',
      sinks: [sink],
      now: () => 1000,
    });

    tracer.onSdkMessage(
      asstMsg([{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 'tu-1', name: 'echo', input: { v: 1 } }]),
    );
    tracer.onSdkMessage(toolResultMsg('tu-1'));
    tracer.onSdkMessage(resultMsg());
    tracer.finalize();

    const kinds = sink.events.map((e) => e.kind);
    // Each SDK message starts with a sdk_event; assistant adds llm_call; user
    // adds tool_invocation; result adds turn_finalized.
    expect(kinds).toEqual([
      'sdk_event', 'llm_call',
      'sdk_event', 'tool_invocation',
      'sdk_event', 'turn_finalized',
    ]);
    const llm = sink.events.find((e) => e.kind === 'llm_call');
    expect(llm?.payload).toMatchObject({ stepIndex: 0, model: 'claude-test' });
  });

  it('flushes pending tool_use blocks on finalize() when the model never replies', () => {
    const sink = new RecordingSink();
    const tracer = new TurnTracer({
      turnId: 't2',
      sessionId: 's2',
      model: 'claude-test',
      sinks: [sink],
    });
    tracer.onSdkMessage(asstMsg([{ type: 'tool_use', id: 'tu-2', name: 'echo', input: {} }]));
    tracer.finalize();

    const invocations = sink.events.filter((e) => e.kind === 'tool_invocation');
    expect(invocations).toHaveLength(1);
    expect(invocations[0]!.payload.ok).toBe(false);
  });

  it('emits a turn_aborted event and ignores subsequent SDK messages', () => {
    const sink = new RecordingSink();
    const tracer = new TurnTracer({
      turnId: 't3',
      sessionId: 's3',
      model: 'claude-test',
      sinks: [sink],
    });
    tracer.onSdkMessage(asstMsg([{ type: 'text', text: 'partial' }]));
    tracer.abort('user_cancel', 'AbortError');
    tracer.onSdkMessage(resultMsg('end_turn'));
    tracer.finalize();

    const aborts = sink.events.filter((e) => e.kind === 'turn_aborted');
    expect(aborts).toHaveLength(1);
    expect(aborts[0]!.payload.reason).toBe('user_cancel');
    // Result message after abort must not produce another turn_finalized.
    expect(sink.events.filter((e) => e.kind === 'turn_finalized')).toHaveLength(0);
  });

  it('isolates sink failures — one bad sink does not stop the others', () => {
    const sink = new RecordingSink();
    const tracer = new TurnTracer({
      turnId: 't4',
      sessionId: 's4',
      model: 'claude-test',
      sinks: [new ThrowingSink(), sink],
    });
    expect(() =>
      tracer.onSdkMessage(asstMsg([{ type: 'text', text: 'hello' }])),
    ).not.toThrow();
    expect(sink.events.length).toBeGreaterThan(0);
  });
});
