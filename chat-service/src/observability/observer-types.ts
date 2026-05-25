/**
 * Observer contract for LLM observability side-channel.
 *
 * ObserverHooks is the interface that all recorder/tracer implementations must
 * satisfy. Events flow through a side channel — never via the yielded SseEvent
 * stream — so the user-facing SSE wire format remains byte-identical.
 *
 * SDK usage-investigation finding:
 *   The claude-agent-sdk SdkAssistantMessage.message only exposes
 *   `content: SdkContentBlock[]` — no per-message `usage` field.
 *   Aggregate usage (input_tokens, output_tokens, total_cost_usd) is available
 *   only on the final `result` SDK message. Per-call token attribution is
 *   therefore approximate: the recorder captures what content blocks are
 *   present (text length, tool args), and the aggregate totals from the result
 *   event are stored at the turn level (chat_turns.input_tokens / output_tokens).
 *   See sse-stream.ts:42-67 for the minimal structural typing we rely on.
 */

// ---------------------------------------------------------------------------
// Observer event shapes
// ---------------------------------------------------------------------------

export interface LlmCallEvent {
  turnId: string;
  /** Incremented per assistant SDK message within a turn (0-based). */
  stepIndex: number;
  /** Model string from RunParams.model (config.chatModel at call time). */
  model: string;
  /**
   * Per-call token counts. Per the SDK investigation above, these will be 0
   * for all calls except the final one whose totals live on the `result` msg.
   * The recorder should treat these as "what was available at emit time".
   */
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  /** Cost is unavailable per-call; always undefined in this SDK version. */
  costUsd?: number;
  /** Wall-clock latency from previous boundary (or run start) to this msg. */
  latencyMs: number;
  startedAt: number;
  endedAt: number;
  /** Raw content array from the assistant message. */
  content: unknown;
  stopReason?: string;
}

export interface ToolInvocationEvent {
  turnId: string;
  /** The tool_use block id from the assistant message content. */
  toolUseId: string;
  name: string;
  args: unknown;
  /** Truncated summary of the tool_result content (≤200 chars). */
  resultSummary: string;
  /** False when tool_use has no matching tool_result (model abandoned). */
  ok: boolean;
  latencyMs: number;
  startedAt: number;
  endedAt: number;
}

export interface SdkEventRecord {
  turnId: string;
  /** Monotonically increasing per-turn sequence number (0-based). */
  seq: number;
  type: string;
  payload: unknown;
  at: number;
}

// ---------------------------------------------------------------------------
// Observer contract
// ---------------------------------------------------------------------------

/**
 * Sync callbacks; implementations may queue/batch internally.
 * All calls are wrapped in try/catch by the runner — a throwing observer
 * never breaks the user-facing turn.
 */
export interface ObserverHooks {
  onLlmCall(call: LlmCallEvent): void;
  onToolInvocation(inv: ToolInvocationEvent): void;
  onSdkEvent(ev: SdkEventRecord): void;
}
