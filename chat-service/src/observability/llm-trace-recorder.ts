/**
 * LlmTraceRecorder — ObserverHooks implementation that writes LLM call traces
 * to the SQLite observability tables (llm_calls, tool_invocations, sdk_events).
 *
 * Instantiated once per turn by turn.ts with a live DB handle + turnId.
 * All methods are synchronous (better-sqlite3). No throw propagation —
 * every INSERT is wrapped in try/catch so a DB failure never disrupts the
 * user-facing SSE stream.
 *
 * Truncation limits (UTF-16 code units):
 *   content_json  → 64 KB  (64 * 1024)
 *   args_json     → 64 KB
 *   result_summary→  4 KB  (4 * 1024)
 *   payload_json  → 64 KB
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { ObserverHooks, LlmCallEvent, ToolInvocationEvent, SdkEventRecord } from './observer-types.js';
import {
  insertLlmCall,
  insertToolInvocation,
  insertSdkEvent,
  truncate,
} from '../db/observability-store.js';

// ---------------------------------------------------------------------------
// Size caps (code units, not bytes — conservative and consistent with SQLite
// TEXT storage which is already UTF-8; keeping the cap in JS string length
// is simpler and only slightly over-estimates for non-BMP chars).
// ---------------------------------------------------------------------------
const CAP_64K = 64 * 1024;
const CAP_4K = 4 * 1024;

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export interface LlmTraceRecorderOptions {
  db: Database.Database;
  turnId: string;
}

export class LlmTraceRecorder implements ObserverHooks {
  private readonly db: Database.Database;
  private readonly turnId: string;

  constructor({ db, turnId }: LlmTraceRecorderOptions) {
    this.db = db;
    this.turnId = turnId;
  }

  /** No-op flush so callers can treat all recorders uniformly. */
  flush(): void {}

  /**
   * Records one LLM assistant message as a row in `llm_calls`.
   * INSERT OR IGNORE — replay-safe on (turn_id, step_index).
   */
  onLlmCall(ev: LlmCallEvent): void {
    try {
      insertLlmCall(this.db, {
        id: uuidv4(),
        turn_id: this.turnId,
        step_index: ev.stepIndex,
        model: ev.model ?? null,
        input_tokens: ev.inputTokens ?? null,
        output_tokens: ev.outputTokens ?? null,
        cache_creation_tokens: ev.cacheCreationTokens ?? null,
        cache_read_tokens: ev.cacheReadTokens ?? null,
        cost_usd: ev.costUsd ?? null,
        latency_ms: ev.latencyMs ?? null,
        started_at: ev.startedAt ?? null,
        ended_at: ev.endedAt ?? null,
        content_json: truncate(ev.content, CAP_64K),
        stop_reason: ev.stopReason ?? null,
      });
    } catch (err) {
      console.warn('[LlmTraceRecorder] onLlmCall insert failed:', err);
    }
  }

  /**
   * Records one tool use/result pair as a row in `tool_invocations`.
   * INSERT OR IGNORE — replay-safe on (turn_id, tool_use_id).
   */
  onToolInvocation(inv: ToolInvocationEvent): void {
    try {
      insertToolInvocation(this.db, {
        id: uuidv4(),
        turn_id: this.turnId,
        tool_use_id: inv.toolUseId,
        name: inv.name,
        args_json: truncate(inv.args, CAP_64K),
        result_summary: truncate(inv.resultSummary, CAP_4K),
        ok: inv.ok ? 1 : 0,
        latency_ms: inv.latencyMs ?? null,
        started_at: inv.startedAt ?? null,
        ended_at: inv.endedAt ?? null,
      });
    } catch (err) {
      console.warn('[LlmTraceRecorder] onToolInvocation insert failed:', err);
    }
  }

  /**
   * Appends one raw SDK event to `sdk_events`.
   * Append-only — no idempotency guard (duplicate SDK msgs are useful signal).
   */
  onSdkEvent(ev: SdkEventRecord): void {
    try {
      insertSdkEvent(this.db, {
        turn_id: this.turnId,
        seq: ev.seq,
        type: ev.type,
        payload_json: truncate(ev.payload, CAP_64K),
        at: ev.at,
      });
    } catch (err) {
      console.warn('[LlmTraceRecorder] onSdkEvent insert failed:', err);
    }
  }
}

/**
 * Buffers observer events in memory and replays them through an inner recorder
 * on `flush()`. Needed because chat_turns FK constraints reject inserts for
 * the assistant turn until that row is appended, which only happens after the
 * runner loop completes — writes issued during the loop would all fail.
 *
 * The composite observer treats this identically to LlmTraceRecorder; the
 * extra flush() call is the only difference at the call site.
 */
export class BufferedLlmTraceRecorder implements ObserverHooks {
  private readonly inner: LlmTraceRecorder;
  private readonly llmCalls: LlmCallEvent[] = [];
  private readonly toolInvocations: ToolInvocationEvent[] = [];
  private readonly sdkEvents: SdkEventRecord[] = [];

  constructor(inner: LlmTraceRecorder) {
    this.inner = inner;
  }

  onLlmCall(ev: LlmCallEvent): void {
    this.llmCalls.push(ev);
  }

  onToolInvocation(inv: ToolInvocationEvent): void {
    this.toolInvocations.push(inv);
  }

  onSdkEvent(ev: SdkEventRecord): void {
    this.sdkEvents.push(ev);
  }

  /** Replay buffered events through the inner recorder in original order. */
  flush(): void {
    for (const ev of this.sdkEvents) this.inner.onSdkEvent(ev);
    for (const ev of this.llmCalls) this.inner.onLlmCall(ev);
    for (const inv of this.toolInvocations) this.inner.onToolInvocation(inv);
    this.llmCalls.length = 0;
    this.toolInvocations.length = 0;
    this.sdkEvents.length = 0;
  }
}
