/**
 * Shared types for chat-service: CubeQuery, QueryArtifact, SseEvent union,
 * ToolContext, and database row shapes.
 */

import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Cube query shape (mirrors what /build consumes)
// ---------------------------------------------------------------------------

export interface TimeDimension {
  dimension: string;
  granularity?: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  dateRange?: string | [string, string];
}

export interface CubeFilter {
  member?: string;
  dimension?: string;
  operator: string;
  values?: string[];
}

export interface CubeQuery {
  measures?: string[];
  dimensions?: string[];
  timeDimensions?: TimeDimension[];
  filters?: CubeFilter[];
  order?: Record<string, 'asc' | 'desc'> | [string, 'asc' | 'desc'][];
  limit?: number;
  offset?: number;
  segments?: string[];
}

// ---------------------------------------------------------------------------
// Query artifact — the clickable card emitted by emit_query_artifact tool
// ---------------------------------------------------------------------------

export interface QueryArtifact {
  id: string;
  title: string;
  summary: string;
  game: string;
  query: CubeQuery;
  source: 'business-metric' | 'segment' | 'raw';
  sourceRef?: { id: string; name?: string };
  previewRows?: number;
  deeplinkUrl: string;
  deeplinkVia: 'inline' | 'session-storage';
  payload?: CubeQuery; // only present when via === 'session-storage'
}

// ---------------------------------------------------------------------------
// SSE event union — all 10 types (+ session_created)
// ---------------------------------------------------------------------------

export type SseEvent =
  | { type: 'session_created'; data: { id: string } }
  | { type: 'loading'; data: Record<string, never> }
  | { type: 'thinking'; data: { delta: string } }
  | { type: 'tool_call'; data: { id: string; name: string; args: unknown } }
  | { type: 'tool_result'; data: { id: string; ok: boolean; ms: number; summary: string } }
  | { type: 'token'; data: { delta: string } }
  | { type: 'query_artifact'; data: QueryArtifact }
  | { type: 'result'; data: { text: string; cost_usd?: number; input_tokens?: number; output_tokens?: number } }
  | { type: 'error'; data: { code: string; message: string } }
  | { type: 'done'; data: Record<string, never> }
  | { type: 'compact_warning'; data: { from: string; to: string; summary: string } };

// ---------------------------------------------------------------------------
// Tool execution context — injected per request
// ---------------------------------------------------------------------------

export interface ToolContext {
  ownerId: string;
  gameId: string;
  cubeToken: string;
  sessionId: string;
  turnId: string;
  sseEmitter: EventEmitter;
}

// ---------------------------------------------------------------------------
// Database row shapes
// ---------------------------------------------------------------------------

export interface ChatSessionRow {
  id: string;
  owner_id: string;
  game_id: string;
  title: string | null;
  created_at: number;
  last_turn_at: number | null;
  turn_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  status: 'active' | 'compacted' | 'archived';
  parent_session_id: string | null;
  compacted_into: string | null;
}

export interface ChatTurnRow {
  id: string;
  session_id: string;
  turn_index: number;
  role: 'user' | 'assistant' | 'system_preamble';
  user_text: string | null;
  assistant_text: string | null;
  reasoning_json: string | null;
  tool_calls_json: string | null;
  artifacts_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  skill: string | null;
  started_at: number;
  ended_at: number | null;
}
