/**
 * claude-runner-observer.test.ts — Tests for observer integration in the runner.
 *
 * Mocks the SDK query() iterator with a deterministic message stream.
 * Validates:
 * - Observer receives expected onLlmCall, onToolInvocation, onSdkEvent signals
 * - SSE byte-equality: yielded SseEvent arrays identical with/without observer
 * - Throwing observer does not break the runner
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { run } from '../../src/core/claude-runner.js';
import type { SseEvent, ToolContext } from '../../src/types.js';
import type { ObserverHooks, LlmCallEvent, ToolInvocationEvent, SdkEventRecord } from '../../src/observability/observer-types.js';

// Mock the query function from the SDK
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual('@anthropic-ai/claude-agent-sdk');
  return {
    ...(actual as any),
    query: vi.fn(),
  };
});

import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk';

describe('claudeRunner with observer', () => {
  const baseToolContext: ToolContext = {
    sessionId: 'session-1',
    turnId: 'turn-1',
    ownerId: 'owner-1',
    gameId: 'game-1',
    cubeToken: 'token-123',
    sseEmitter: new EventEmitter(),
  };

  /**
   * Helper to collect all yielded SseEvents into an array.
   */
  async function collectSseEvents(
    iterable: AsyncIterable<SseEvent>,
  ): Promise<SseEvent[]> {
    const events: SseEvent[] = [];
    for await (const event of iterable) {
      events.push(event);
    }
    return events;
  }

  /**
   * Build a deterministic SDK message stream:
   * system init → assistant(text+tool_use A) → user(tool_result A) →
   * assistant(text+tool_use B) → user(tool_result B) → assistant(text) → result
   */
  function buildSdkMessageStream() {
    return [
      // 1. system_init
      {
        type: 'system_init' as const,
      },

      // 2. assistant message with text + tool_use A
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me query the data' },
            {
              type: 'tool_use',
              id: 'tool-use-1',
              name: 'test_tool',
              input: { query: 'SELECT *' },
            },
          ],
        },
      },

      // 3. user message with tool_result A
      {
        type: 'user' as const,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-use-1',
              content: 'Query successful',
            },
          ],
        },
      },

      // 4. assistant message with text + tool_use B
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me do one more query' },
            {
              type: 'tool_use',
              id: 'tool-use-2',
              name: 'test_tool',
              input: { query: 'SELECT COUNT(*)' },
            },
          ],
        },
      },

      // 5. user message with tool_result B
      {
        type: 'user' as const,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-use-2',
              content: '42',
            },
          ],
        },
      },

      // 6. assistant message with final text (no tool_use)
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'The result is 42',
            },
          ],
        },
      },

      // 7. result message (final)
      {
        type: 'result' as const,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'The result is 42',
            },
          ],
        },
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          total_cost_usd: 0.01,
        },
        stop_reason: 'end_turn',
      },
    ];
  }

  describe('observer event emission', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (query as any).mockImplementation(async function* () {
        for (const msg of buildSdkMessageStream()) {
          yield msg;
        }
      });
    });

    it('emits onSdkEvent for each SDK message', async () => {
      const sdkEvents: SdkEventRecord[] = [];
      const observer: ObserverHooks = {
        onLlmCall: () => {},
        onToolInvocation: () => {},
        onSdkEvent: (ev) => sdkEvents.push(ev),
      };

      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer,
      };

      const events = await collectSseEvents(run(params));

      // Should have 7 SDK events (one per message type)
      expect(sdkEvents).toHaveLength(7);
      expect(sdkEvents[0].seq).toBe(0);
      expect(sdkEvents[0].type).toBe('system_init');
      expect(sdkEvents[1].seq).toBe(1);
      expect(sdkEvents[1].type).toBe('assistant');
      expect(sdkEvents[6].seq).toBe(6);
      expect(sdkEvents[6].type).toBe('result');
    });

    it('emits onLlmCall for each assistant message', async () => {
      const llmCalls: LlmCallEvent[] = [];
      const observer: ObserverHooks = {
        onLlmCall: (ev) => llmCalls.push(ev),
        onToolInvocation: () => {},
        onSdkEvent: () => {},
      };

      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer,
      };

      await collectSseEvents(run(params));

      // 3 assistant messages
      expect(llmCalls).toHaveLength(3);

      // Each should have stepIndex 0, 1, 2
      expect(llmCalls[0].stepIndex).toBe(0);
      expect(llmCalls[1].stepIndex).toBe(1);
      expect(llmCalls[2].stepIndex).toBe(2);

      // Content captured
      expect(llmCalls[0].content).toHaveLength(2);
      expect((llmCalls[0].content as any[])[0].type).toBe('text');
      expect((llmCalls[0].content as any[])[1].type).toBe('tool_use');
    });

    it('emits onToolInvocation for tool_use/tool_result pairs', async () => {
      const toolInvocations: ToolInvocationEvent[] = [];
      const observer: ObserverHooks = {
        onLlmCall: () => {},
        onToolInvocation: (inv) => toolInvocations.push(inv),
        onSdkEvent: () => {},
      };

      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer,
      };

      await collectSseEvents(run(params));

      // 2 tool invocations
      expect(toolInvocations).toHaveLength(2);

      expect(toolInvocations[0].toolUseId).toBe('tool-use-1');
      expect(toolInvocations[0].name).toBe('test_tool');
      expect(toolInvocations[0].ok).toBe(true);
      expect(toolInvocations[0].latencyMs).toBeGreaterThanOrEqual(0);

      expect(toolInvocations[1].toolUseId).toBe('tool-use-2');
      expect(toolInvocations[1].name).toBe('test_tool');
      expect(toolInvocations[1].ok).toBe(true);
      expect(toolInvocations[1].latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SSE byte-equality regression test', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (query as any).mockImplementation(async function* () {
        for (const msg of buildSdkMessageStream()) {
          yield msg;
        }
      });
    });

    it('produces identical SseEvent arrays with and without observer', async () => {
      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
      };

      // Run WITHOUT observer
      const withoutObserver = await collectSseEvents(run(params));

      // Reset mock for second run
      (query as any).mockImplementation(async function* () {
        for (const msg of buildSdkMessageStream()) {
          yield msg;
        }
      });

      // Run WITH a no-op observer
      const noOpObserver: ObserverHooks = {
        onLlmCall: () => {},
        onToolInvocation: () => {},
        onSdkEvent: () => {},
      };

      const withObserver = await collectSseEvents(run({ ...params, observer: noOpObserver }));

      // Serialize to JSON strings for byte-by-byte comparison
      const withoutStr = JSON.stringify(withoutObserver);
      const withStr = JSON.stringify(withObserver);

      expect(withStr).toBe(withoutStr);
      expect(withObserver).toEqual(withoutObserver);
    });
  });

  describe('observer error handling', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (query as any).mockImplementation(async function* () {
        for (const msg of buildSdkMessageStream()) {
          yield msg;
        }
      });
    });

    it('does not crash when observer throws', async () => {
      let throwCount = 0;
      const observer: ObserverHooks = {
        onLlmCall: () => {
          throwCount++;
          throw new Error('observer error');
        },
        onToolInvocation: () => {},
        onSdkEvent: () => {},
      };

      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer,
      };

      // Should not throw
      const events = await collectSseEvents(run(params));

      // Should still yield SSE events
      expect(events.length).toBeGreaterThan(0);

      // Observer should have been called (and thrown)
      expect(throwCount).toBeGreaterThan(0);
    });

    it('continues calling non-throwing observer methods when one throws', async () => {
      const sdkEventCount: number[] = [];
      const observer: ObserverHooks = {
        onLlmCall: () => {
          throw new Error('llm call error');
        },
        onToolInvocation: () => {},
        onSdkEvent: () => {
          sdkEventCount.push(1);
        },
      };

      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer,
      };

      await collectSseEvents(run(params));

      // SDK events should still have been observed despite onLlmCall throwing
      expect(sdkEventCount.length).toBeGreaterThan(0);
    });

    it('handles observer undefined gracefully', async () => {
      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer: undefined,
      };

      // Should not throw
      const events = await collectSseEvents(run(params));

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('tool invocation tracking', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (query as any).mockImplementation(async function* () {
        // Message stream with tool_use that never gets a tool_result
        yield {
          type: 'system_init' as const,
        };

        yield {
          type: 'assistant' as const,
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me query' },
              {
                type: 'tool_use',
                id: 'tool-use-1',
                name: 'test_tool',
                input: { query: 'SELECT *' },
              },
            ],
          },
        };

        // No tool_result — model abandoned the tool invocation

        yield {
          type: 'assistant' as const,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'I changed my mind',
              },
            ],
          },
        };

        yield {
          type: 'result' as const,
          message: {
            role: 'assistant',
            content: [],
          },
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            total_cost_usd: 0.01,
          },
          stop_reason: 'end_turn',
        };
      });
    });

    it('emits tool invocation with ok=false when tool_use never gets tool_result', async () => {
      const toolInvocations: ToolInvocationEvent[] = [];
      const observer: ObserverHooks = {
        onLlmCall: () => {},
        onToolInvocation: (inv) => toolInvocations.push(inv),
        onSdkEvent: () => {},
      };

      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer,
      };

      await collectSseEvents(run(params));

      // Should emit the abandoned tool invocation
      expect(toolInvocations).toHaveLength(1);
      expect(toolInvocations[0].toolUseId).toBe('tool-use-1');
      expect(toolInvocations[0].ok).toBe(false);
      expect(toolInvocations[0].resultSummary).toBe('no_result');
    });
  });

  describe('latency measurement', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (query as any).mockImplementation(async function* () {
        for (const msg of buildSdkMessageStream()) {
          yield msg;
        }
      });
    });

    it('latency_ms is measured for each LLM call', async () => {
      const llmCalls: LlmCallEvent[] = [];
      const observer: ObserverHooks = {
        onLlmCall: (ev) => llmCalls.push(ev),
        onToolInvocation: () => {},
        onSdkEvent: () => {},
      };

      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer,
      };

      await collectSseEvents(run(params));

      // All latencies should be >= 0
      for (const call of llmCalls) {
        expect(call.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('latency_ms is measured for each tool invocation', async () => {
      const toolInvocations: ToolInvocationEvent[] = [];
      const observer: ObserverHooks = {
        onLlmCall: () => {},
        onToolInvocation: (inv) => toolInvocations.push(inv),
        onSdkEvent: () => {},
      };

      const params = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        systemPrompt: 'You are helpful',
        allowedToolNames: [],
        message: 'Hello',
        tools: [],
        toolContext: baseToolContext,
        observer,
      };

      await collectSseEvents(run(params));

      // All latencies should be >= 0
      for (const inv of toolInvocations) {
        expect(inv.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
