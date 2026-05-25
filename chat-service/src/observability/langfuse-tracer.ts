/**
 * langfuse-tracer.ts — ObserverHooks implementation that mirrors per-turn
 * telemetry to Langfuse Cloud (env-gated).
 *
 * Disabled path (no env keys):
 *   - constructor sets this.disabled = true
 *   - every method returns on the first line — zero allocations
 *
 * Enabled path per-turn shape:
 *   - One Langfuse trace  (id = turnId, sessionId, userId = ownerId)
 *   - One generation per onLlmCall  (model, content as output, usage = 0 — SDK
 *     does not expose per-call token counts; see observer-types.ts header)
 *   - One span per onToolInvocation (name, args as input, resultSummary as output)
 *   - sdk_events intentionally NOT mirrored: too noisy; SQLite owns raw firehose
 *
 * NOTE: finalize(aggregate) is a public method (not on ObserverHooks) that
 * turn.ts (phase 05) calls explicitly once the result message is available.
 * If ObserverHooks ever grows a "turn complete" hook, migrate there. Until
 * then this explicit call keeps the contract clean without modifying observer-types.ts.
 */

import type { LangfuseTraceClient, Langfuse } from 'langfuse';
import type { ObserverHooks, LlmCallEvent, ToolInvocationEvent, SdkEventRecord } from './observer-types.js';
import { createLangfuseClient } from './langfuse-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LangfuseTracerOptions {
  turnId: string;
  sessionId: string;
  ownerId: string;
  /** Active skill name, e.g. "cube-query". Defaults to "unknown" if absent. */
  skill?: string;
  /** gameId metadata tag (optional). */
  gameId?: string;
  /** Model name for trace-level metadata. */
  model?: string;
}

export interface AggregateUsage {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves after `ms` milliseconds — used for flush timeout. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// LangfuseTracer
// ---------------------------------------------------------------------------

export class LangfuseTracer implements ObserverHooks {
  private readonly disabled: boolean;
  private readonly client: Langfuse | null;
  private readonly opts: LangfuseTracerOptions;

  /** Lazily initialised on first observer event (ensureTrace). */
  private trace: LangfuseTraceClient | null = null;

  constructor(opts: LangfuseTracerOptions) {
    this.opts = opts;
    this.client = createLangfuseClient();
    // Disabled when client factory returned null (missing keys or ctor threw).
    this.disabled = this.client === null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Creates the Langfuse trace on the first observed event (lazy init).
   * Idempotent — subsequent calls return the cached trace.
   */
  private ensureTrace(): LangfuseTraceClient | null {
    if (this.disabled || !this.client) return null;
    if (this.trace) return this.trace;

    try {
      const { turnId, sessionId, ownerId, skill, gameId, model } = this.opts;
      this.trace = this.client.trace({
        id: turnId,
        name: `chat-turn:${skill ?? 'unknown'}`,
        sessionId,
        userId: ownerId,
        metadata: { gameId, skill, model },
      });
    } catch (err) {
      console.warn('[LangfuseTracer] trace() failed:', err);
      return null;
    }

    return this.trace;
  }

  // ---------------------------------------------------------------------------
  // ObserverHooks
  // ---------------------------------------------------------------------------

  /**
   * Mirrors one LLM assistant message as a Langfuse generation.
   *
   * Token counts passed to Langfuse are those emitted by the observer event.
   * Per the SDK investigation in observer-types.ts, these are 0 for all calls
   * except where partial counts were available — full aggregates land via
   * finalize(). We record them anyway so Langfuse has something to display.
   */
  onLlmCall(ev: LlmCallEvent): void {
    if (this.disabled) return;

    const trace = this.ensureTrace();
    if (!trace) return;

    try {
      trace.generation({
        name: `llm-call:${ev.stepIndex}`,
        model: ev.model,
        // Content array stored as output; input not captured at call-level
        // (full conversation history is large; SQLite owns the raw payload).
        output: ev.content,
        usage: {
          input: ev.inputTokens,
          output: ev.outputTokens,
          total: ev.inputTokens + ev.outputTokens,
        },
        startTime: new Date(ev.startedAt),
        endTime: new Date(ev.endedAt),
        metadata: {
          stepIndex: ev.stepIndex,
          stopReason: ev.stopReason,
          latencyMs: ev.latencyMs,
          cacheCreationTokens: ev.cacheCreationTokens,
          cacheReadTokens: ev.cacheReadTokens,
        },
      });
    } catch (err) {
      console.warn('[LangfuseTracer] generation() failed:', err);
    }
  }

  /**
   * Mirrors one tool use/result pair as a Langfuse span.
   */
  onToolInvocation(inv: ToolInvocationEvent): void {
    if (this.disabled) return;

    const trace = this.ensureTrace();
    if (!trace) return;

    try {
      trace.span({
        name: `tool:${inv.name}`,
        input: inv.args,
        output: inv.resultSummary,
        startTime: new Date(inv.startedAt),
        endTime: new Date(inv.endedAt),
        metadata: {
          toolUseId: inv.toolUseId,
          ok: inv.ok,
          latencyMs: inv.latencyMs,
        },
      });
    } catch (err) {
      console.warn('[LangfuseTracer] span() failed:', err);
    }
  }

  /**
   * SDK events are intentionally NOT mirrored to Langfuse.
   * Rationale: sdk_events are a raw firehose (dozens per turn). Langfuse is
   * purpose-built for summarised generation/span views; SQLite owns the raw
   * firehose. Mirroring would inflate costs and noise the Langfuse dashboard.
   */
  onSdkEvent(_ev: SdkEventRecord): void {
    // Intentional no-op — see method JSDoc above.
  }

  // ---------------------------------------------------------------------------
  // Public extras (not on ObserverHooks — called explicitly by turn.ts)
  // ---------------------------------------------------------------------------

  /**
   * Attaches aggregate token usage + cost to the trace-level output once the
   * result message is available. Called by turn.ts after the runner completes.
   *
   * If ObserverHooks ever gains a "turn complete" hook, migrate this call there.
   * Until then, turn.ts calls finalize() explicitly in its finally block.
   */
  finalize(usage: AggregateUsage): void {
    if (this.disabled || !this.trace) return;

    try {
      this.trace.update({
        output: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalCostUsd: usage.totalCostUsd,
        },
      });
    } catch (err) {
      console.warn('[LangfuseTracer] finalize() trace.update failed:', err);
    }
  }

  /**
   * Flushes the Langfuse queue to the network.
   * Bounded to 2 seconds — never blocks the response beyond that.
   * Safe to call even when no trace was created (early-return, no await).
   */
  async flush(): Promise<void> {
    if (this.disabled || !this.client) return;

    try {
      await Promise.race([
        this.client.shutdownAsync(),
        delay(2_000),
      ]);
    } catch (err) {
      console.warn('[LangfuseTracer] flush() failed (swallowed):', err);
    }
  }
}
