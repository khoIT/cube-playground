/**
 * ObserverSinkAdapter (Phase 05) — verifies the bridge from TraceEvent into
 * the legacy ObserverHooks call surface. This is the layer that lets us
 * keep `LlmTraceRecorder` + `LangfuseTracer` plugged in unchanged while the
 * new TurnTracer assumes ownership of the dispatch loop.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObserverSinkAdapter } from '../../src/observability/sinks/observer-sink-adapter.js';

describe('ObserverSinkAdapter', () => {
  it('forwards each TraceEvent kind to the matching observer hook', () => {
    const observer = {
      onLlmCall: vi.fn(),
      onToolInvocation: vi.fn(),
      onSdkEvent: vi.fn(),
      onTurnFinalized: vi.fn(),
      onPermissionDecision: vi.fn(),
      onTurnAborted: vi.fn(),
    };
    const adapter = new ObserverSinkAdapter('test', observer);

    adapter.emit({
      kind: 'llm_call',
      payload: {
        turnId: 't', stepIndex: 0, model: 'm',
        inputTokens: 0, outputTokens: 0,
        latencyMs: 1, startedAt: 0, endedAt: 1,
        content: [],
      },
    });
    adapter.emit({
      kind: 'tool_invocation',
      payload: {
        turnId: 't', toolUseId: 'tu', name: 'echo', args: {},
        resultSummary: 'ok', ok: true,
        latencyMs: 1, startedAt: 0, endedAt: 1,
      },
    });
    adapter.emit({
      kind: 'sdk_event',
      payload: { turnId: 't', seq: 0, type: 'assistant', payload: {}, at: 0 },
    });
    adapter.emit({
      kind: 'turn_finalized',
      payload: { turnId: 't', stopReason: 'end_turn', totalInputTokens: 1, totalOutputTokens: 1, at: 0 },
    });
    adapter.emit({
      kind: 'permission_decision',
      payload: { id: 'p', turnId: 't', toolName: 'echo', decision: 'denied', reason: null, at: 0 },
    });
    adapter.emit({
      kind: 'turn_aborted',
      payload: { turnId: 't', reason: 'timeout', at: 0 },
    });

    expect(observer.onLlmCall).toHaveBeenCalledTimes(1);
    expect(observer.onToolInvocation).toHaveBeenCalledTimes(1);
    expect(observer.onSdkEvent).toHaveBeenCalledTimes(1);
    expect(observer.onTurnFinalized).toHaveBeenCalledTimes(1);
    expect(observer.onPermissionDecision).toHaveBeenCalledTimes(1);
    expect(observer.onTurnAborted).toHaveBeenCalledTimes(1);
  });

  it('silently discards kinds the observer doesn\'t implement', () => {
    const observer = {
      onLlmCall: vi.fn(),
      onToolInvocation: vi.fn(),
      onSdkEvent: vi.fn(),
      // no onTurnFinalized / onPermissionDecision / onTurnAborted
    };
    const adapter = new ObserverSinkAdapter('partial', observer);
    expect(() =>
      adapter.emit({
        kind: 'turn_aborted',
        payload: { turnId: 't', reason: 'server_error', at: 0 },
      }),
    ).not.toThrow();
  });
});
