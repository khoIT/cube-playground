/**
 * langfuse-tracer.test.ts — Tests for the Langfuse mirror observer.
 *
 * Mocks the Langfuse client and validates:
 * - Without env keys: all methods are no-ops
 * - With env keys: trace created lazily, generations/spans mirrored
 * - Errors swallowed, never propagate
 * - flush() bounded to 2s timeout
 * - finalize() updates trace with aggregate usage
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { LlmCallEvent, ToolInvocationEvent } from '../../src/observability/observer-types.js';
import { LangfuseTracer } from '../../src/observability/langfuse-tracer.js';

// Mock the langfuse-client module before importing langfuse-tracer
vi.mock('../../src/observability/langfuse-client.js', () => ({
  createLangfuseClient: vi.fn(),
}));

import { createLangfuseClient } from '../../src/observability/langfuse-client.js';

describe('LangfuseTracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('disabled path (no env keys)', () => {
    beforeEach(() => {
      (createLangfuseClient as any).mockReturnValue(null);
    });

    it('all methods are no-ops when client is null', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      const event: LlmCallEvent = {
        turnId: 'turn-1',
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
      expect(() => tracer.onLlmCall(event)).not.toThrow();
    });

    it('flush resolves immediately when disabled', async () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      const start = Date.now();
      await tracer.flush();
      const elapsed = Date.now() - start;

      // Should resolve almost instantly (< 100ms)
      expect(elapsed).toBeLessThan(100);
    });

    it('finalize is a no-op when disabled', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      expect(() => {
        tracer.finalize({
          inputTokens: 100,
          outputTokens: 200,
          totalCostUsd: 0.01,
        });
      }).not.toThrow();
    });
  });

  describe('enabled path (with mocked client)', () => {
    let mockTrace: any;
    let mockClient: any;

    beforeEach(() => {
      mockTrace = {
        generation: vi.fn(),
        span: vi.fn(),
        update: vi.fn(),
      };

      mockClient = {
        trace: vi.fn().mockReturnValue(mockTrace),
        shutdownAsync: vi.fn().mockResolvedValue(undefined),
      };

      (createLangfuseClient as any).mockReturnValue(mockClient);
    });

    it('creates trace lazily on first event', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
        skill: 'cube-query',
        gameId: 'game-1',
        model: 'claude-3-5-sonnet',
      });

      // Trace not created yet
      expect(mockClient.trace).not.toHaveBeenCalled();

      const event: LlmCallEvent = {
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [{ type: 'text', text: 'hello' }],
      };

      tracer.onLlmCall(event);

      // Now trace should be created
      expect(mockClient.trace).toHaveBeenCalledOnce();
      const traceCall = mockClient.trace.mock.calls[0][0];
      expect(traceCall.id).toBe('turn-1');
      expect(traceCall.sessionId).toBe('session-1');
      expect(traceCall.userId).toBe('owner-1');
      expect(traceCall.metadata).toEqual({
        gameId: 'game-1',
        skill: 'cube-query',
        model: 'claude-3-5-sonnet',
      });
    });

    it('calls generation() on onLlmCall', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      const event: LlmCallEvent = {
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [{ type: 'text', text: 'hello' }],
        stopReason: 'end_turn',
      };

      tracer.onLlmCall(event);

      expect(mockTrace.generation).toHaveBeenCalledOnce();
      const genCall = mockTrace.generation.mock.calls[0][0];
      expect(genCall.name).toBe('llm-call:0');
      expect(genCall.model).toBe('claude-3-5-sonnet');
      expect(genCall.output).toEqual(event.content);
      expect(genCall.usage).toEqual({
        input: 100,
        output: 200,
        total: 300,
      });
      expect(genCall.metadata).toEqual({
        stepIndex: 0,
        stopReason: 'end_turn',
        latencyMs: 1000,
        cacheCreationTokens: undefined,
        cacheReadTokens: undefined,
      });
    });

    it('calls span() on onToolInvocation', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      // First create the trace
      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      });

      mockTrace.generation.mockClear();

      const toolEvent = {
        turnId: 'turn-1',
        toolUseId: 'tool-use-1',
        name: 'test_tool',
        args: { query: 'SELECT *' },
        resultSummary: 'ok',
        ok: true,
        latencyMs: 500,
        startedAt: 2000,
        endedAt: 2500,
      };

      tracer.onToolInvocation(toolEvent);

      expect(mockTrace.span).toHaveBeenCalledOnce();
      const spanCall = mockTrace.span.mock.calls[0][0];
      expect(spanCall.name).toBe('tool:test_tool');
      expect(spanCall.input).toEqual({ query: 'SELECT *' });
      expect(spanCall.output).toBe('ok');
      expect(spanCall.metadata).toEqual({
        toolUseId: 'tool-use-1',
        ok: true,
        latencyMs: 500,
      });
    });

    it('onSdkEvent is a no-op (intentional)', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      // Create trace first
      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      });

      const sdkEvent = {
        turnId: 'turn-1',
        seq: 0,
        type: 'message_start',
        payload: { type: 'message_start' },
        at: Date.now(),
      };

      // Should not call any trace methods
      const initialCallCount = mockTrace.generation.mock.calls.length;
      tracer.onSdkEvent(sdkEvent);
      expect(mockTrace.generation.mock.calls.length).toBe(initialCallCount);
    });

    it('finalize() updates trace with aggregate usage', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      // Create trace first
      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      });

      tracer.finalize({
        inputTokens: 500,
        outputTokens: 1000,
        totalCostUsd: 0.05,
      });

      expect(mockTrace.update).toHaveBeenCalledOnce();
      const updateCall = mockTrace.update.mock.calls[0][0];
      expect(updateCall.output).toEqual({
        inputTokens: 500,
        outputTokens: 1000,
        totalCostUsd: 0.05,
      });
    });

    it('generation() throwing is swallowed', () => {
      mockTrace.generation.mockImplementation(() => {
        throw new Error('generation failed');
      });

      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      const event: LlmCallEvent = {
        turnId: 'turn-1',
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
      expect(() => tracer.onLlmCall(event)).not.toThrow();
    });

    it('span() throwing is swallowed', () => {
      mockTrace.span.mockImplementation(() => {
        throw new Error('span failed');
      });

      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      // Create trace first
      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      });

      const toolEvent = {
        turnId: 'turn-1',
        toolUseId: 'tool-use-1',
        name: 'test_tool',
        args: {},
        resultSummary: 'ok',
        ok: true,
        latencyMs: 500,
        startedAt: 2000,
        endedAt: 2500,
      };

      // Should not throw
      expect(() => tracer.onToolInvocation(toolEvent)).not.toThrow();
    });

    it('update() throwing in finalize is swallowed', () => {
      mockTrace.update.mockImplementation(() => {
        throw new Error('update failed');
      });

      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      // Create trace first
      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      });

      // Should not throw
      expect(() => {
        tracer.finalize({
          inputTokens: 500,
          outputTokens: 1000,
        });
      }).not.toThrow();
    });

    it('flush is bounded by 2 second timeout', async () => {
      mockClient.shutdownAsync.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000))
      );

      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      const start = Date.now();
      await tracer.flush();
      const elapsed = Date.now() - start;

      // Should be bounded to ~2000ms, not 5000ms
      expect(elapsed).toBeLessThan(3000);
      expect(elapsed).toBeGreaterThanOrEqual(2000);
    });

    it('flush() swallows shutdownAsync errors', async () => {
      mockClient.shutdownAsync.mockRejectedValue(new Error('shutdown failed'));

      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      // Should not throw
      await expect(tracer.flush()).resolves.toBeUndefined();
    });

    it('reuses trace on multiple events (idempotent creation)', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      // Emit two LLM events
      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      });

      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 1,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 2000,
        endedAt: 3000,
        content: [],
      });

      // trace() should only be called once
      expect(mockClient.trace).toHaveBeenCalledOnce();
      // But generation() should be called twice
      expect(mockTrace.generation).toHaveBeenCalledTimes(2);
    });

    it('handles trace creation error gracefully', () => {
      mockClient.trace.mockImplementation(() => {
        throw new Error('trace creation failed');
      });

      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      const event: LlmCallEvent = {
        turnId: 'turn-1',
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
      expect(() => tracer.onLlmCall(event)).not.toThrow();
    });

    it('subsequent calls after trace creation fails are handled', () => {
      mockClient.trace.mockImplementation(() => {
        throw new Error('trace creation failed');
      });

      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
      });

      const event: LlmCallEvent = {
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      };

      // Call multiple times — all should be safe no-ops
      expect(() => {
        tracer.onLlmCall(event);
        tracer.onLlmCall(event);
        tracer.finalize({ inputTokens: 100, outputTokens: 200 });
      }).not.toThrow();
    });
  });

  describe('metadata handling', () => {
    let mockTrace: any;
    let mockClient: any;

    beforeEach(() => {
      mockTrace = {
        generation: vi.fn(),
        span: vi.fn(),
        update: vi.fn(),
      };

      mockClient = {
        trace: vi.fn().mockReturnValue(mockTrace),
        shutdownAsync: vi.fn().mockResolvedValue(undefined),
      };

      (createLangfuseClient as any).mockReturnValue(mockClient);
    });

    it('uses "unknown" skill when not provided', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
        // No skill provided
      });

      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      });

      const traceCall = mockClient.trace.mock.calls[0][0];
      expect(traceCall.name).toBe('chat-turn:unknown');
      expect(traceCall.metadata.skill).toBeUndefined();
    });

    it('includes provided metadata in trace', () => {
      const tracer = new LangfuseTracer({
        turnId: 'turn-1',
        sessionId: 'session-1',
        ownerId: 'owner-1',
        skill: 'cube-query',
        gameId: 'game-123',
        model: 'claude-3-5-sonnet',
      });

      tracer.onLlmCall({
        turnId: 'turn-1',
        stepIndex: 0,
        model: 'claude-3-5-sonnet',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1000,
        startedAt: 1000,
        endedAt: 2000,
        content: [],
      });

      const traceCall = mockClient.trace.mock.calls[0][0];
      expect(traceCall.metadata.skill).toBe('cube-query');
      expect(traceCall.metadata.gameId).toBe('game-123');
      expect(traceCall.metadata.model).toBe('claude-3-5-sonnet');
    });
  });
});
