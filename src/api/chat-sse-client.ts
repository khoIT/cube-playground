/**
 * chat-sse-client — thin SSE client for POST /api/chat/sessions/:id/turn.
 *
 * Returns { stream: AsyncIterable<SseEvent>, cancel: () => void }.
 * Parses text/event-stream line-by-line (double-newline delimited blocks).
 * Handles backpressure via AbortController.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SseEventBase {
  type: string;
}

export interface SseSessionCreated extends SseEventBase {
  type: 'session_created';
  data: { id: string };
}
export interface SseLoading extends SseEventBase {
  type: 'loading';
  data: Record<string, never>;
}
export interface SseThinking extends SseEventBase {
  type: 'thinking';
  data: { delta: string };
}
export interface SseToolCall extends SseEventBase {
  type: 'tool_call';
  data: { id: string; name: string; args: unknown };
}
export interface SseToolResult extends SseEventBase {
  type: 'tool_result';
  data: { id: string; ok: boolean; ms: number; summary: string };
}
export interface SseToken extends SseEventBase {
  type: 'token';
  data: { delta: string };
}

/** Chart spec — declarative shape produced by the LLM, compiled at render time. */
export type ChartType =
  | 'bar'
  | 'horizontal-bar'
  | 'stacked-bar'
  | 'line'
  | 'multi-line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter';

export interface ChartSpec {
  type: ChartType;
  title: string;
  caption?: string;
  data: Array<Record<string, string | number>>;
  encoding: { category: string; value: string; series?: string };
}

/** Compiled chart artifact emitted via SSE / embedded on a query artifact. */
export interface ChartArtifact {
  id: string;
  spec: ChartSpec;
  /** True if the server truncated rows into an "Other" lump. */
  truncated: boolean;
  /** Row count before truncation (informational). */
  originalRowCount: number;
  /** Pointer to a parent query_artifact when the chart was attached. */
  artifactRef?: string;
}

/** QueryArtifact shape — mirrors chat-service/src/types.ts */
export interface QueryArtifact {
  id: string;
  title: string;
  summary: string;
  query: unknown;
  source: 'business-metric' | 'segment' | 'raw';
  sourceRef?: { id: string; name?: string };
  deeplinkUrl: string;
  deeplinkVia: 'inline' | 'session-storage';
  payload: unknown;
  /** Optional inline chart suggested by the LLM at emit time. */
  chart?: ChartArtifact;
}

export interface SseQueryArtifact extends SseEventBase {
  type: 'query_artifact';
  data: QueryArtifact;
}

export interface SseChart extends SseEventBase {
  type: 'chart';
  data: ChartArtifact;
}

export interface DisambigOption {
  /** Human label shown on the chip (e.g. "ARPDAU"). */
  label: string;
  /** Text sent on click — drives the next turn's disambiguator. */
  pinText: string;
  /** Optional confidence hint for ordering / a11y. */
  confidence?: number;
}

export interface SseDisambigOptions extends SseEventBase {
  type: 'disambig_options';
  data: {
    slot: 'metric' | 'dimension' | 'timeRange';
    prompt: string;
    options: DisambigOption[];
  };
}
export interface SseResult extends SseEventBase {
  type: 'result';
  data: {
    text: string;
    cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
    /** True when this turn was served from response_cache (vs live LLM). */
    cache_hit?: boolean;
    /** Freshness of cached payload — set only when cache_hit=true. */
    cache_freshness?: 'refreshed' | 'stale';
  };
}
export interface SseError extends SseEventBase {
  type: 'error';
  data: { code: string; message: string };
}
export interface SseDone extends SseEventBase {
  type: 'done';
  data: Record<string, never>;
}

export interface SseCompactWarning extends SseEventBase {
  type: 'compact_warning';
  data: { from: string; to: string; summary: string };
}

/**
 * Phase-04 — server emits this once per turn immediately after registering
 * with the stream registry. The FE captures `turnId` for cancellation; until
 * this event arrives the cancel button stays hidden because there's nothing
 * to address the abort to.
 */
export interface SseTurnStarted extends SseEventBase {
  type: 'turn_started';
  data: { turnId: string };
}

/**
 * Phase-04 — emitted when the turn ends early (user cancel, server-side
 * timeout, fatal error). Always followed by `done`. The FE flips state into
 * a terminal "aborted" view + suppresses follow-up retry-on-empty flows.
 */
export interface SseTurnAborted extends SseEventBase {
  type: 'turn_aborted';
  data: {
    reason: 'user_cancel' | 'timeout' | 'server_error';
    message?: string;
  };
}

/**
 * Phase-03 — fired after the session focus bag changes (post-turn write).
 * Replaces the local hook's slice so the chat-header chip refreshes without
 * an extra GET round-trip. Shape mirrors the GET /focus response's `focus`
 * field so the consuming hook reuses one normaliser.
 */
export interface SseFocusUpdated extends SseEventBase {
  type: 'focus_updated';
  data: {
    sessionId: string;
    focus: unknown;
  };
}

/** Phase-03 — fired when DELETE /focus succeeds. The chip empties. */
export interface SseFocusReset extends SseEventBase {
  type: 'focus_reset';
  data: { sessionId: string };
}

export type SseEvent =
  | SseSessionCreated
  | SseLoading
  | SseThinking
  | SseToolCall
  | SseToolResult
  | SseToken
  | SseQueryArtifact
  | SseChart
  | SseDisambigOptions
  | SseResult
  | SseError
  | SseDone
  | SseCompactWarning
  | SseTurnStarted
  | SseTurnAborted
  | SseFocusUpdated
  | SseFocusReset;

// ---------------------------------------------------------------------------
// Owner ID helper — re-exported for tests; sourced from shared module so
// non-SSE consumers (useChatSession, useChatSessionsList, rename/delete
// menus) can stamp the same header without pulling in the SSE client.
// ---------------------------------------------------------------------------

import { getOwnerId } from './chat-owner-id';
import { readChatServiceSettings } from '../pages/Settings/ChatService/use-chat-service-settings';

// ---------------------------------------------------------------------------
// SSE parser — splits raw text into (type, data) pairs
// ---------------------------------------------------------------------------

interface RawSseBlock {
  event: string;
  data: string;
}

/**
 * Parse accumulated SSE buffer into blocks on each `\n\n` boundary.
 * Returns { blocks, remainder } where remainder is the partial block
 * not yet terminated.
 */
function parseSseBuffer(
  buffer: string,
): { blocks: RawSseBlock[]; remainder: string } {
  const parts = buffer.split('\n\n');
  const remainder = parts.pop() ?? '';
  const blocks: RawSseBlock[] = [];

  for (const part of parts) {
    const lines = part.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice('data:'.length).trim();
      }
    }
    if (event && data !== '') {
      blocks.push({ event, data });
    }
  }
  return { blocks, remainder };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OpenChatTurnOptions {
  sessionId: string | null;
  message: string;
  game: string;
  context?: unknown;
  /** Disambiguation mode forwarded to chat-service; defaults server-side. */
  mode?: 'targeted' | 'aggressive';
  /** Phase-06: when true, sends X-Bypass-Cache: 1 to force a fresh LLM call. */
  bypassCache?: boolean;
}

export interface ChatTurnHandle {
  stream: AsyncIterable<SseEvent>;
  cancel: () => void;
}

/**
 * Parse a fetch Response body as an SSE stream and yield typed events.
 * Shared between `openChatTurn` (POST /turn) and `openChatTurnReplay`
 * (GET /stream-replay). The caller owns the AbortController/signal — this
 * helper just respects it.
 */
export async function* parseSseFromResponse(
  response: Response,
  signal: AbortSignal,
): AsyncIterable<SseEvent> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let errData: { code: string; message: string };
    try {
      errData = JSON.parse(body);
    } catch {
      errData = { code: `http_${response.status}`, message: body || response.statusText };
    }
    yield { type: 'error', data: errData } as SseError;
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: 'error', data: { code: 'no_body', message: 'Response has no body' } } as SseError;
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const { blocks, remainder } = parseSseBuffer(buffer);
      buffer = remainder;

      for (const block of blocks) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(block.data);
        } catch {
          continue;
        }
        yield { type: block.event, data: parsed } as SseEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Open a streaming chat turn against the server proxy.
 *
 * - sessionId: null or 'new' → server creates a new session.
 * - The returned AsyncIterable yields parsed SseEvent objects.
 * - call cancel() to abort in-flight.
 */
export function openChatTurn(options: OpenChatTurnOptions): ChatTurnHandle {
  const { sessionId, message, game, context, mode, bypassCache } = options;
  const controller = new AbortController();

  const pathId = sessionId && sessionId !== 'new' ? sessionId : 'new';
  const url = `/api/chat/sessions/${pathId}/turn`;

  async function* generateEvents(): AsyncIterable<SseEvent> {
    let response: Response;
    try {
      const globalSettings = readChatServiceSettings();
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Owner-Id': getOwnerId(),
      };
      // Per-message bypass (from chat composer quick toggle) OR settings-level bypass.
      if (bypassCache || globalSettings.bypassCache) reqHeaders['X-Bypass-Cache'] = '1';
      // Settings-level model override (allowlist checked server-side).
      if (globalSettings.defaultModel) reqHeaders['X-Model'] = globalSettings.defaultModel;
      response = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({ message, game, context, mode }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || controller.signal.aborted)
      ) {
        return;
      }
      throw err;
    }
    yield* parseSseFromResponse(response, controller.signal);
  }

  return {
    stream: generateEvents(),
    cancel: () => controller.abort(),
  };
}

// ---------------------------------------------------------------------------
// Replay (Phase 7) — attaches to an in-flight turn after a refresh.
// ---------------------------------------------------------------------------

export interface OpenChatTurnReplayOptions {
  sessionId: string;
  turnId: string;
  fromOffset?: number;
}

/**
 * 409 response body shape — server signals ring overflow with the latest
 * contiguous frame available so the client can retry from that offset.
 */
export interface ReplayOverflow {
  code: 'ring_overflow';
  availableFromOffset: number;
  totalEmitted: number;
}

export class ReplayOverflowError extends Error {
  readonly availableFromOffset: number;
  constructor(info: ReplayOverflow) {
    super(`Replay overflow — earliest available offset is ${info.availableFromOffset}`);
    this.name = 'ReplayOverflowError';
    this.availableFromOffset = info.availableFromOffset;
  }
}

/**
 * Open a replay stream for an in-flight turn. The endpoint serves buffered
 * events from `fromOffset` then tails the live registry until done/error.
 *
 * Throws `ReplayOverflowError` synchronously (before yielding any events)
 * when the server returns 409 — caller is expected to retry from the
 * `availableFromOffset` returned.
 */
export function openChatTurnReplay(
  options: OpenChatTurnReplayOptions,
): ChatTurnHandle {
  const { sessionId, turnId, fromOffset = 0 } = options;
  const controller = new AbortController();

  const params = new URLSearchParams({ turnId });
  if (fromOffset > 0) params.set('from', String(fromOffset));
  const url = `/api/chat/sessions/${encodeURIComponent(sessionId)}/stream-replay?${params}`;

  async function* generateEvents(): AsyncIterable<SseEvent> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'X-Owner-Id': getOwnerId(),
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || controller.signal.aborted)
      ) {
        return;
      }
      throw err;
    }

    // 409 → ring overflow. Parse the JSON body before letting parseSseFromResponse
    // swallow it as a generic SseError.
    if (response.status === 409) {
      const body = await response.text().catch(() => '');
      let info: ReplayOverflow;
      try {
        info = JSON.parse(body) as ReplayOverflow;
      } catch {
        info = { code: 'ring_overflow', availableFromOffset: 0, totalEmitted: 0 };
      }
      throw new ReplayOverflowError(info);
    }

    yield* parseSseFromResponse(response, controller.signal);
  }

  return {
    stream: generateEvents(),
    cancel: () => controller.abort(),
  };
}
