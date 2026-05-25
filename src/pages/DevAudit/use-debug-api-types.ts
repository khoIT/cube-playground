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

export interface DebugTurnDetail {
  llmCalls: LlmCall[];
  toolInvocations: ToolInvocation[];
}
