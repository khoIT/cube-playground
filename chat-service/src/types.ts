/**
 * Shared types for chat-service: CubeQuery, QueryArtifact, SseEvent union,
 * ToolContext, and database row shapes.
 */

import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import type { ChartArtifact } from './services/chart-spec.js';

export type { ChartSpec, ChartType, ChartArtifact } from './services/chart-spec.js';

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
  /** Optional inline chart suggested by the LLM at emit time. */
  chart?: ChartArtifact;
}

// ---------------------------------------------------------------------------
// SSE event union — all 10 types (+ session_created)
// ---------------------------------------------------------------------------

export type SseEvent =
  | { type: 'session_created'; data: { id: string } }
  | { type: 'turn_started'; data: { turnId: string } }
  | { type: 'loading'; data: Record<string, never> }
  | { type: 'thinking'; data: { delta: string } }
  | { type: 'tool_call'; data: { id: string; name: string; args: unknown } }
  | { type: 'tool_result'; data: { id: string; ok: boolean; ms: number; summary: string } }
  | { type: 'token'; data: { delta: string } }
  | { type: 'query_artifact'; data: QueryArtifact }
  | { type: 'chart'; data: ChartArtifact }
  | {
      type: 'result';
      data: {
        text: string;
        cost_usd?: number;
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_tokens?: number;
        cache_read_tokens?: number;
        /** True when assistant response was served from response_cache (vs live LLM). */
        cache_hit?: boolean;
        /**
         * Freshness of cached payload — set only when cache_hit=true.
         *   'refreshed' — chart data re-executed live against Cube during replay.
         *   'stale'     — payload served from cache as-is.
         */
        cache_freshness?: 'refreshed' | 'stale';
      };
    }
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
  /**
   * Database handle for tools that read/write persistent state (e.g. cache
   * adapters). Optional so unit tests don't have to construct a full DB; the
   * tools that consume it must no-op when this is absent.
   */
  db?: Database.Database;
  /** Optional clock override for tests. Defaults to Date.now. */
  now?: () => number;
  /**
   * Per-request disambiguation mode set by the user via the chat panel chip.
   * Defaults to 'targeted' server-side when the client omits it.
   */
  disambiguationMode?: 'targeted' | 'aggressive';
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
  /** Epoch ms when soft-deleted; NULL = not deleted. Set by soft-delete, cleared by restore. */
  deleted_at: number | null;
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
  charts_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  skill: string | null;
  started_at: number;
  ended_at: number | null;
  // Observability columns — nullable for backfill compat with pre-feature turns.
  system_prompt_text: string | null;
  model: string | null;
  /** Phase-02: turn-level stop_reason from SDK result message. Undefined for legacy installs missing the column. */
  stop_reason?: string | null;
  /** Phase-03: cache tokens from Anthropic SDK result usage block. Null for legacy turns. */
  cache_creation_tokens?: number | null;
  cache_read_tokens?: number | null;
  /** Phase-06: 1 when turn was served from response cache; 0/null otherwise. */
  cache_hit?: number | null;
  /** Phase-06: original_turn_id when cache_hit=1; null otherwise. */
  original_turn_id?: string | null;
  /**
   * Freshness flag on cache-hit turns:
   *   'refreshed' — chart data re-executed against live Cube on replay.
   *   'stale'     — served from cache without re-execute.
   * NULL for non-cache-hit turns.
   */
  cache_freshness?: 'refreshed' | 'stale' | null;
}

// ---------------------------------------------------------------------------
// Observability row shapes (llm_calls, tool_invocations, sdk_events tables)
// ---------------------------------------------------------------------------

export interface LlmCallRow {
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

export interface ToolInvocationRow {
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

export interface SdkEventRow {
  id: number;
  turn_id: string;
  seq: number;
  type: string;
  payload_json: string | null;
  at: number;
}

/** Phase-02: one row per permission denial from SDK result message. */
export interface PermissionDecisionRow {
  id: string;
  turn_id: string;
  tool_name: string;
  decision: string;
  reason: string | null;
  at: number;
}
