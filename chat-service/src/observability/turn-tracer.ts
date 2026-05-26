/**
 * Phase 05 — single entry point for turn observability.
 *
 * Today, `claude-runner.ts` calls four different emit*() helpers from
 * `sdk-event-extractor.ts` (one per SDK message shape). Each call re-derives
 * context (latencies, content blocks, pending-tool maps) that the SDK has
 * already encoded. The TurnTracer below consolidates that surface so the
 * runner's loop body collapses to a single `tracer.onSdkMessage(msg)` call.
 *
 * The tracer is intentionally a thin adapter over the existing emit helpers —
 * the field semantics stay byte-identical so a parallel-emit shim can A/B
 * the new path against the legacy ObserverHooks-style dispatch before any
 * cutover deletes the old code.
 *
 * State invariants:
 *   - `stepIndex` increments on every `assistant` message.
 *   - `lastBoundary` is the wall-clock anchor for the next `latencyMs`.
 *   - `pendingTools` outlives a single message — tool_use → tool_result.
 *   - `aborted` flips on `abort()`; subsequent `finalize()` is a no-op.
 */

import {
  emitLlmCall,
  emitToolInvocations,
  emitTurnFinalized,
  emitSdkEvent,
  flushPendingTools,
  type PendingTool,
} from './sdk-event-extractor.js';
import type { ObserverHooks } from './observer-types.js';
import type { TraceEvent, TraceSink } from './trace-event.js';

export interface TurnTracerOptions {
  turnId: string;
  sessionId: string;
  model: string;
  sinks: TraceSink[];
  /** Optional clock injection for tests. Defaults to Date.now. */
  now?: () => number;
}

export class TurnTracer {
  readonly turnId: string;
  readonly sessionId: string;
  private readonly model: string;
  private readonly sinks: TraceSink[];
  private readonly now: () => number;
  private readonly pendingTools: Map<string, PendingTool> = new Map();
  private stepIndex = 0;
  private lastBoundary: number;
  private seq = 0;
  private aborted = false;
  // Adapter that forwards observer hook callbacks straight into the sink fan-out.
  private readonly observerAdapter: ObserverHooks;

  constructor(opts: TurnTracerOptions) {
    this.turnId = opts.turnId;
    this.sessionId = opts.sessionId;
    this.model = opts.model;
    this.sinks = opts.sinks;
    this.now = opts.now ?? Date.now;
    this.lastBoundary = this.now();
    this.observerAdapter = this.buildObserverAdapter();
  }

  /**
   * Drive the tracer from one SDK message. Mirrors what claude-runner.ts
   * currently does in-line at three different call sites. The signature is
   * the only thing the runner needs to know.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSdkMessage(msg: any): void {
    if (this.aborted) return;
    const at = this.now();
    emitSdkEvent(this.observerAdapter, this.turnId, this.seq++, msg);

    if (msg?.type === 'assistant') {
      const newBoundary = emitLlmCall(
        this.observerAdapter,
        this.turnId,
        this.stepIndex,
        this.model,
        this.lastBoundary,
        msg,
        this.pendingTools,
      );
      this.stepIndex += 1;
      this.lastBoundary = newBoundary;
      return;
    }
    if (msg?.type === 'user') {
      emitToolInvocations(this.observerAdapter, this.turnId, msg, this.pendingTools);
      return;
    }
    if (msg?.type === 'result') {
      emitTurnFinalized(this.observerAdapter, this.turnId, msg);
      return;
    }
    void at; // hold a reference so the lint rule doesn't strip the local
  }

  /**
   * Called from the runner's finally block. Flushes tool_use entries with no
   * matching tool_result so a dropped invocation still produces a trace row.
   */
  finalize(): void {
    if (this.aborted) return;
    if (this.pendingTools.size > 0) {
      flushPendingTools(this.observerAdapter, this.turnId, this.pendingTools);
      this.pendingTools.clear();
    }
  }

  /**
   * Phase 04 — record an early termination. The runner already emits its own
   * `turn_aborted` SSE event; this is the observability-side mirror so sinks
   * can persist the reason. Subsequent `onSdkMessage` / `finalize` are no-ops.
   */
  abort(reason: 'user_cancel' | 'timeout' | 'server_error', message?: string): void {
    if (this.aborted) return;
    this.aborted = true;
    this.dispatch({
      kind: 'turn_aborted',
      payload: { turnId: this.turnId, reason, message, at: this.now() },
    });
  }

  // ---------------------------------------------------------------------------
  // Internal — fan out to sinks; isolate failures so one bad sink doesn't kill
  // the rest.
  // ---------------------------------------------------------------------------

  private dispatch(event: TraceEvent): void {
    for (const sink of this.sinks) {
      try {
        sink.emit(event);
      } catch (err) {
        // Mirror composite-observer.ts's swallow-and-log pattern. Use
        // console.warn rather than a structured logger so the tracer remains
        // dependency-free for unit tests.
        // eslint-disable-next-line no-console
        console.warn(`[TurnTracer] sink "${sink.name}" emit failed:`, err);
      }
    }
  }

  private buildObserverAdapter(): ObserverHooks {
    return {
      onLlmCall: (payload) => this.dispatch({ kind: 'llm_call', payload }),
      onToolInvocation: (payload) => this.dispatch({ kind: 'tool_invocation', payload }),
      onSdkEvent: (payload) => this.dispatch({ kind: 'sdk_event', payload }),
      onTurnFinalized: (payload) => this.dispatch({ kind: 'turn_finalized', payload }),
      onPermissionDecision: (payload) =>
        this.dispatch({ kind: 'permission_decision', payload }),
    };
  }
}
