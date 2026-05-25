/**
 * Shared TypeScript types for the /dev/chat-audit debug API.
 * Mirrors the DTO shapes returned by chat-service debug routes.
 */

export interface DebugSession {
  id: string;
  title: string | null;
  owner_id: string;
  game_id: string;
  created_at: number;
  last_turn_at: number | null;
  turn_count: number;
  status: string;
  /** Epoch ms when soft-deleted; null = live session. Set by soft-delete, cleared by restore. */
  deletedAt: number | null;
}

export interface DebugTurn {
  id: string;
  role: 'user' | 'assistant' | 'system_preamble';
  text: string;
  createdAt: string;
  toolCalls: Array<{ id: string; name: string; ok: boolean; ms: number; summary: string }>;
  legacy: boolean;
  llmCallCount: number;
  toolInvocationCount: number;
  // Aggregate per-turn totals from chat_turns. Per-call usage is unavailable
  // from the Agent SDK so the result-message aggregate lives at the turn level.
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  model: string | null;
  skill: string | null;
  durationMs: number | null;
  /** Phase-02: turn-level stop_reason from SDK result message. Null for legacy turns. */
  stopReason: string | null;
  /** Phase-03: Anthropic cache token breakdown. Null for legacy turns pre-migration. */
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  /** Phase-06: true when this turn was served from the response cache. */
  cacheHit: boolean;
  /** Phase-06: original turn id that seeded the cache entry; null for non-cached turns. */
  originalTurnId: string | null;
  /** Phase-06: session id of the original cached turn; null for non-cached turns. */
  originalSessionId: string | null;
}

export interface LlmCall {
  id: string;
  turn_id: string;
  step_index: number;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  started_at: number | null;
  ended_at: number | null;
  content_json: string | null;
  stop_reason: string | null;
}

export interface ToolInvocation {
  id: string;
  turn_id: string;
  tool_use_id: string;
  name: string;
  args_json: string | null;
  result_summary: string | null;
  /** SQLite stores booleans as 0/1 integers. */
  ok: number;
  latency_ms: number | null;
  started_at: number | null;
  ended_at: number | null;
}

export interface SdkEvent {
  id: number;
  turn_id: string;
  seq: number;
  type: string;
  payload_json: string | null;
  at: number;
}

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

export interface DebugSessionDetail {
  session: DebugSession;
  turns: DebugTurn[];
}

/** Phase-02: one permission denial from the SDK result message. */
export interface PermissionDecision {
  id: string;
  turn_id: string;
  tool_name: string;
  decision: string;
  reason: string | null;
  at: number;
}

export interface DebugTurnDetail {
  llmCalls: LlmCall[];
  toolInvocations: ToolInvocation[];
  /** Phase-02: empty for turns in bypassPermissions mode; populated when permissions are denied. */
  permissionDecisions: PermissionDecision[];
  /** Phase-04: annotation for this turn; null/undefined when not annotated. */
  annotation?: TurnAnnotation | null;
}

// ---------------------------------------------------------------------------
// Phase-04: turn annotations + cross-turn search
// ---------------------------------------------------------------------------

/** Flag values for a turn annotation. `null` means no flag set. */
export type AnnotationFlag = 'bug' | 'important' | 'review' | null;

/** Per-turn annotation DTO returned by POST /debug/turns/:id/annotation. */
export interface TurnAnnotation {
  turnId: string;
  starred: boolean;
  flag: AnnotationFlag;
  note: string | null;
  updatedAt: number;
}

/** One result from GET /debug/search. */
export interface SearchHit {
  turnId: string;
  sessionId: string;
  sessionTitle: string | null;
  role: string;
  snippet: string;
  matchSource: 'user_text' | 'assistant_text' | 'tool';
  createdAt: string;
  starred: boolean;
  flag: AnnotationFlag;
}

/** Paginated response from GET /debug/search. */
export interface SearchPage {
  results: SearchHit[];
  nextCursor: string | null;
}
