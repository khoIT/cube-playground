/**
 * composite-observer.test.ts — Tests for the multicasting observer.
 *
 * Validates that events fan out to all child observers and that one observer
 * throwing does not prevent subsequent observers from receiving the event.
 */

import { describe, it, expect } from 'vitest';
import { buildCompositeObserver } from '../../src/observability/composite-observer.js';
import type { ObserverHooks, LlmCallEvent, ToolInvocationEvent, SdkEventRecord } from '../../src/observability/observer-types.js';

describe('buildCompositeObserver', () => {
  it('distributes events to all child observers', () => {
    const events1: LlmCallEvent[] = [];
    const events2: LlmCallEvent[] = [];

    const obs1: ObserverHooks = {
      onLlmCall: (ev) => events1.push(ev),
      onToolInvocation: () => {},
      onSdkEvent: () => {},
    };

    const obs2: ObserverHooks = {
      onLlmCall: (ev) => events2.push(ev),
      onToolInvocation: () => {},
      onSdkEvent: () => {},
    };

    const composite = buildCompositeObserver([obs1, obs2]);

    const event: LlmCallEvent = {
      turnId: 'turn-1',
      stepIndex: 0,
      model: 'claude-3-5-sonnet',
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      content: [],
    };

    composite.onLlmCall(event);

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0]).toEqual(event);
    expect(events2[0]).toEqual(event);
  });

  it('continues distributing when one observer throws', () => {
    const events: LlmCallEvent[] = [];
    let error1Thrown = false;

    const throwerObs: ObserverHooks = {
      onLlmCall: () => {
        error1Thrown = true;
        throw new Error('observer 1 error');
      },
      onToolInvocation: () => {},
      onSdkEvent: () => {},
    };

    const catcherObs: ObserverHooks = {
      onLlmCall: (ev) => events.push(ev),
      onToolInvocation: () => {},
      onSdkEvent: () => {},
    };

    const composite = buildCompositeObserver([throwerObs, catcherObs]);

    const event: LlmCallEvent = {
      turnId: 'turn-1',
      stepIndex: 0,
      model: 'claude-3-5-sonnet',
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      content: [],
    };

    // Composite should not throw
    expect(() => composite.onLlmCall(event)).not.toThrow();

    // First observer should have thrown internally
    expect(error1Thrown).toBe(true);

    // Second observer should still have received the event
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it('multicasts onToolInvocation to all observers', () => {
    const tools1: ToolInvocationEvent[] = [];
    const tools2: ToolInvocationEvent[] = [];

    const obs1: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: (inv) => tools1.push(inv),
      onSdkEvent: () => {},
    };

    const obs2: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: (inv) => tools2.push(inv),
      onSdkEvent: () => {},
    };

    const composite = buildCompositeObserver([obs1, obs2]);

    const event: ToolInvocationEvent = {
      turnId: 'turn-1',
      toolUseId: 'tool-use-1',
      name: 'test_tool',
      args: { x: 1 },
      resultSummary: 'ok',
      ok: true,
      latencyMs: 50,
      startedAt: Date.now() - 50,
      endedAt: Date.now(),
    };

    composite.onToolInvocation(event);

    expect(tools1).toHaveLength(1);
    expect(tools2).toHaveLength(1);
    expect(tools1[0]).toEqual(event);
    expect(tools2[0]).toEqual(event);
  });

  it('multicasts onSdkEvent to all observers', () => {
    const sdk1: SdkEventRecord[] = [];
    const sdk2: SdkEventRecord[] = [];

    const obs1: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: () => {},
      onSdkEvent: (ev) => sdk1.push(ev),
    };

    const obs2: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: () => {},
      onSdkEvent: (ev) => sdk2.push(ev),
    };

    const composite = buildCompositeObserver([obs1, obs2]);

    const event: SdkEventRecord = {
      turnId: 'turn-1',
      seq: 0,
      type: 'message_start',
      payload: { type: 'message_start' },
      at: Date.now(),
    };

    composite.onSdkEvent(event);

    expect(sdk1).toHaveLength(1);
    expect(sdk2).toHaveLength(1);
    expect(sdk1[0]).toEqual(event);
    expect(sdk2[0]).toEqual(event);
  });

  it('handles empty observer list gracefully', () => {
    const composite = buildCompositeObserver([]);

    const llmEvent: LlmCallEvent = {
      turnId: 'turn-1',
      stepIndex: 0,
      model: 'claude-3-5-sonnet',
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      content: [],
    };

    const toolEvent: ToolInvocationEvent = {
      turnId: 'turn-1',
      toolUseId: 'tool-use-1',
      name: 'test_tool',
      args: {},
      resultSummary: 'ok',
      ok: true,
      latencyMs: 50,
      startedAt: Date.now() - 50,
      endedAt: Date.now(),
    };

    const sdkEvent: SdkEventRecord = {
      turnId: 'turn-1',
      seq: 0,
      type: 'message_start',
      payload: {},
      at: Date.now(),
    };

    // All should be no-ops
    expect(() => {
      composite.onLlmCall(llmEvent);
      composite.onToolInvocation(toolEvent);
      composite.onSdkEvent(sdkEvent);
    }).not.toThrow();
  });

  it('throws from different methods are swallowed independently', () => {
    let toolThrowerCalled = false;
    let sdkThrowerCalled = false;
    const events: LlmCallEvent[] = [];

    const toolThrower: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: () => {
        toolThrowerCalled = true;
        throw new Error('tool thrower');
      },
      onSdkEvent: () => {},
    };

    const sdkThrower: ObserverHooks = {
      onLlmCall: () => {},
      onToolInvocation: () => {},
      onSdkEvent: () => {
        sdkThrowerCalled = true;
        throw new Error('sdk thrower');
      },
    };

    const catcher: ObserverHooks = {
      onLlmCall: (ev) => events.push(ev),
      onToolInvocation: () => {},
      onSdkEvent: () => {},
    };

    const composite = buildCompositeObserver([toolThrower, sdkThrower, catcher]);

    const llmEvent: LlmCallEvent = {
      turnId: 'turn-1',
      stepIndex: 0,
      model: 'claude-3-5-sonnet',
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      content: [],
    };

    composite.onLlmCall(llmEvent);
    expect(events).toHaveLength(1);

    const toolEvent: ToolInvocationEvent = {
      turnId: 'turn-1',
      toolUseId: 'tool-use-1',
      name: 'test_tool',
      args: {},
      resultSummary: 'ok',
      ok: true,
      latencyMs: 50,
      startedAt: Date.now() - 50,
      endedAt: Date.now(),
    };

    composite.onToolInvocation(toolEvent);
    expect(toolThrowerCalled).toBe(true);

    const sdkEvent: SdkEventRecord = {
      turnId: 'turn-1',
      seq: 0,
      type: 'message_start',
      payload: {},
      at: Date.now(),
    };

    composite.onSdkEvent(sdkEvent);
    expect(sdkThrowerCalled).toBe(true);
  });
});
