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
      type: 'disambig_options';
      data: {
        /**
         * Slot the user is being asked to resolve. The chip click pins this
         * slot in the next turn so the disambig tool routes auto. The engine
         * disambiguator uses the three fixed slots; 'choice' is the open slot
         * for agent-authored turn-ending option sets (offer_choices), whose
         * pinText is a self-contained instruction rather than a slot value.
         */
        slot: 'metric' | 'dimension' | 'timeRange' | 'choice';
        /** Short prompt to display above the chip row. */
        prompt: string;
        /** Chip-friendly option list, ordered by candidate confidence. */
        options: Array<{
          /** Human label shown on the chip (e.g. "ARPDAU"). */
          label: string;
          /**
           * Text to send when the chip is clicked — embeds the locked field
           * token so the disambig tool resolves the slot without re-asking.
           */
          pinText: string;
          /** Optional confidence hint for ordering / a11y. */
          confidence?: number;
        }>;
      };
    }
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
  | {
      type: 'error';
      data: {
        /** Machine-readable category from the error classifier (e.g. llm_gateway_forbidden). */
        code: string;
        /** Raw underlying error text (the SDK/gateway message). */
        message: string;
        /** Short human-facing headline for the error banner. */
        title?: string;
        /** Actionable "where to fix" guidance (VPN / key / connectivity). */
        hint?: string;
        /** Present for rate-limit errors so the FE can show a countdown. */
        retry_after_ms?: number;
      };
    }
  | { type: 'done'; data: Record<string, never> }
  | { type: 'compact_warning'; data: { from: string; to: string; summary: string } }
  /**
   * Phase-01: emitted when a turn opens by resuming a prior SDK conversation.
   * `sdkConversationId` is truncated (first 8 chars) for debug visibility; the
   * full id never crosses the SSE boundary.
   */
  | { type: 'context_resumed'; data: { sdkConversationId: string; priorTurnCount: number } }
  /**
   * Phase-01: emitted by claude-runner once the SDK reveals the session id on
   * the first turn so the API layer can persist it. Internal — the API hook
   * strips it from the FE-bound stream.
   */
  | { type: 'sdk_session_captured'; data: { sdkConversationId: string } }
  /**
   * Server-internal (never forwarded to FE): which auth lane the runner used
   * for this attempt ('primary'|'stg'|'backup' gateway keys, 'subscription'
   * OAuth token). Yielded once per attempt — a key-failover retry overwrites,
   * so the last value is the lane that actually served the turn. Persisted to
   * chat_turns.llm_auth_label for audit/cost attribution.
   */
  | { type: 'auth_lane_used'; data: { label: string } }
  /**
   * Phase-01: emitted on auto-compaction.
   * `tokensSaved` is a best-effort delta from the pre-compact running total.
   */
  | {
      type: 'context_compacted';
      data: {
        oldSessionId: string;
        newSessionId: string;
        tokensSaved: number;
        artifactCount: number;
        summaryLength: number;
      };
    }
  /**
   * Phase 04 — emitted when a turn ends early via user cancel, server
   * timeout, or an unrecoverable error path. Always followed by `done`. The
   * FE renders a "[cancelled]" or "[timed out]" marker and stops the spinner.
   * Partial assistant text up to the abort point is still persisted on the
   * chat_turns row.
   */
  | {
      type: 'turn_aborted';
      data: {
        reason: 'user_cancel' | 'timeout' | 'server_error';
        message?: string;
      };
    }
  /**
   * Phase 03 — fired after the session focus bag is written (post-turn or
   * via a focus DELETE). The chat-header chip re-renders from the new bag.
   * Value shape mirrors the GET /api/chat/sessions/:id/focus response so the
   * FE hook can replace its slice without an extra fetch.
   */
  | {
      type: 'focus_updated';
      data: {
        sessionId: string;
        focus: import('./cache/session-focus-adapter.js').SessionFocus;
      };
    }
  /**
   * Phase 03 — fired when DELETE /api/chat/sessions/:id/focus succeeds. Both
   * layers (session focus + SDK resume id) are cleared; the chip empties.
   */
  | {
      type: 'focus_reset';
      data: { sessionId: string };
    };

// ---------------------------------------------------------------------------
// Tool execution context — injected per request
// ---------------------------------------------------------------------------

export interface ToolContext {
  ownerId: string;
  gameId: string;
  cubeToken: string;
  /**
   * Cube data workspace id ("local", "prod", …) for this turn. Outbound Cube
   * fetches go through the Fastify proxy carrying this header so the
   * workspace-aware proxy resolves auth + base URL on the server side.
   * Defaults to 'local' when absent so legacy callers keep working.
   */
  workspace: string;
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
  /**
   * Phase-01: Claude Agent SDK conversation id captured on the first turn.
   * When CHAT_CONTEXT_SDK_RESUME is on, passed back on subsequent turns so
   * the model sees its full prior thread. Cleared on compaction (new session
   * starts fresh). Optional for legacy rows missing the column.
   */
  sdk_conversation_id?: string | null;
  /**
   * Cube data workspace this session belongs to ("local", "prod", …). Sessions
   * are partitioned by workspace so switching workspaces hides sessions whose
   * cube refs target a different namespace. Defaults to 'local' for legacy rows.
   */
  workspace: string;
  /**
   * Sharing state. 'private' (default) = only the owner sees it; 'shared' =
   * any authenticated team member can open it read-only. Owner-only to change.
   */
  visibility: 'private' | 'shared';
  /** Display name for the owner, stamped at creation for "shared by …" UI. */
  owner_label: string | null;
  /** Epoch ms when the session was last set to 'shared'; NULL when private. */
  shared_at: number | null;
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
  /**
   * Auth lane that served the turn: 'primary' | 'stg' | 'backup' (gateway
   * keys) or 'subscription' (Claude subscription OAuth token). NULL for
   * legacy turns and cache-hit replays (no LLM call made).
   */
  llm_auth_label?: string | null;
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
