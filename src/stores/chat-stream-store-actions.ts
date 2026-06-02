/**
 * Pure event→state reducer for the chat-stream store.
 *
 * Kept separate so the store file stays under 200 lines and so the reducer
 * can be unit-tested independently of the Zustand wiring (the live stream
 * keeps its own refcount + cancel handle but the state transitions are
 * pure functions of (entry, event)).
 */
import type {
  SseEvent,
  QueryArtifact,
  ChartArtifact,
  SseDisambigOptions,
} from '../api/chat-sse-client';
import type { SessionFocusClient } from '../api/chat-session-focus-client';

export type DisambigOptionsPayload = SseDisambigOptions['data'];

export type StreamStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'done'
  | 'error'
  | 'disconnected'
  | 'rate_limited'
  /** Phase 04 — turn ended early via user cancel, server timeout, or fatal error. */
  | 'aborted';

/** Phase 04 — captured from the `turn_aborted` SSE event before `done`. */
export interface AbortInfo {
  reason: 'user_cancel' | 'timeout' | 'server_error';
  message?: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  args?: unknown;
  status: 'pending' | 'ok' | 'error';
  ms?: number;
  summary?: string;
}

export interface CompactWarning {
  from: string;
  to: string;
  summary: string;
}

/** Per-session streaming slice. Stored in `Map<sessionId, StreamEntry>`. */
export interface StreamEntry {
  sessionId: string | null;
  /** Active turnId once known (server emits `turn_started` in Phase 5). */
  turnId: string | null;
  status: StreamStatus;
  currentText: string;
  currentReasoning: string;
  currentArtifacts: QueryArtifact[];
  currentCharts: ChartArtifact[];
  currentToolCalls: ToolCallState[];
  error: string | null;
  /** Classifier headline + actionable hint, set alongside `error` (server-classified). */
  errorTitle: string | null;
  errorHint: string | null;
  lastCompactWarning: CompactWarning | null;
  retryAfterMs: number | null;
  refCount: number;
  /** Cancel handle for the live SSE fetch. */
  cancel?: () => void;
  /** True when the in-flight turn was served from the response cache. */
  cacheHit?: boolean;
  /** Freshness of the cached payload — set only when cacheHit=true. */
  cacheFreshness?: 'refreshed' | 'stale' | null;
  /**
   * Most-recent disambiguation chip set the server asked us to render.
   * Cleared on the next user submission. Null when no chips are pending.
   */
  disambigOptions?: DisambigOptionsPayload | null;
  /** Phase 04 — populated when the server emits `turn_aborted`. */
  abort?: AbortInfo | null;
  /**
   * Phase 03 — latest session-focus bag emitted by the server during this
   * turn. The chat-header chip prefers this over its own GET when present so
   * the chip refreshes <200ms after focus mutates. `null` after focus_reset
   * fires; `undefined` when no focus event has arrived yet.
   */
  latestFocus?: SessionFocusClient | null;
}

export function makeIdleEntry(sessionId: string | null): StreamEntry {
  return {
    sessionId,
    turnId: null,
    status: 'idle',
    currentText: '',
    currentReasoning: '',
    currentArtifacts: [],
    currentCharts: [],
    currentToolCalls: [],
    error: null,
    errorTitle: null,
    errorHint: null,
    lastCompactWarning: null,
    retryAfterMs: null,
    refCount: 0,
  };
}

/**
 * Apply an SSE event to an entry. Pure: produces a new entry, never mutates.
 * Status side-effects (e.g. transitioning to 'error' on an error event with
 * a `rate_limited` code) are handled here so callers can stay thin.
 */
export function applySseEvent(entry: StreamEntry, event: SseEvent): StreamEntry {
  switch (event.type) {
    case 'session_created':
      return { ...entry, sessionId: event.data.id };

    case 'turn_started':
      // Phase 04 — turnId becomes addressable for the cancel endpoint. Don't
      // touch status because `loading` typically fires alongside this event.
      return { ...entry, turnId: event.data.turnId };

    case 'turn_aborted':
      // Phase 04 — server confirms early termination. `done` is expected to
      // arrive immediately after. The status flips here so a `done` reducer
      // pass below doesn't overwrite the aborted state, but `done` is still
      // what flushes streaming buffers in the parent component.
      return {
        ...entry,
        status: 'aborted',
        abort: { reason: event.data.reason, message: event.data.message },
      };

    case 'focus_updated':
      // Phase 03 — server snapshotted the post-turn focus bag. The chat
      // header chip subscribes to this slice via useSessionFocus.
      return { ...entry, latestFocus: event.data.focus as SessionFocusClient };

    case 'focus_reset':
      // Phase 03 — user (or /forget) wiped both layers. Mark the slot null so
      // the chip can distinguish "no event yet" (undefined) from "empty bag"
      // (null) — only the latter forces a chip clear without an extra GET.
      return { ...entry, latestFocus: null };

    case 'loading':
      return { ...entry, status: 'loading' };

    case 'thinking':
      return {
        ...entry,
        currentReasoning: entry.currentReasoning + event.data.delta,
      };

    case 'token':
      return {
        ...entry,
        status: 'streaming',
        currentText: entry.currentText + event.data.delta,
      };

    case 'tool_call': {
      if (entry.currentToolCalls.find((t) => t.id === event.data.id)) return entry;
      return {
        ...entry,
        currentToolCalls: [
          ...entry.currentToolCalls,
          {
            id: event.data.id,
            name: event.data.name,
            args: event.data.args,
            status: 'pending',
          },
        ],
      };
    }

    case 'tool_result':
      return {
        ...entry,
        currentToolCalls: entry.currentToolCalls.map((t) =>
          t.id === event.data.id
            ? {
                ...t,
                status: event.data.ok ? 'ok' : 'error',
                ms: event.data.ms,
                summary: event.data.summary,
              }
            : t,
        ),
      };

    case 'query_artifact':
      return {
        ...entry,
        currentArtifacts: [...entry.currentArtifacts, event.data],
      };

    case 'chart':
      return { ...entry, currentCharts: [...entry.currentCharts, event.data] };

    case 'disambig_options':
      // Latest chip set replaces any prior one (LLM may re-disambiguate on
      // narrowed slots). Cleared in clearStreamBuffers on the next turn.
      return { ...entry, disambigOptions: event.data };

    case 'compact_warning':
      return {
        ...entry,
        sessionId: event.data.to,
        lastCompactWarning: {
          from: event.data.from,
          to: event.data.to,
          summary: event.data.summary,
        },
      };

    case 'result': {
      // `result` carries the final text snapshot + cache metadata. Always
      // capture cache flags so the live message can render the badge before
      // hydration from the persisted turn row.
      const next: StreamEntry = {
        ...entry,
        cacheHit: event.data.cache_hit ?? entry.cacheHit ?? false,
        cacheFreshness: event.data.cache_hit
          ? event.data.cache_freshness ?? null
          : entry.cacheFreshness ?? null,
      };
      if (event.data.text && !entry.currentText) {
        next.currentText = event.data.text;
      }
      return next;
    }

    case 'done':
      // Phase 04 — if a `turn_aborted` reached us first, keep that status so
      // the FE doesn't flicker from aborted→done. The closing `done` is just
      // a stream-close marker in that case.
      if (entry.status === 'aborted') return entry;
      return { ...entry, status: 'done' };

    case 'error': {
      const data = event.data as {
        code: string;
        message: string;
        title?: string;
        hint?: string;
        retry_after_ms?: number;
      };
      if (data.code === 'rate_limited' && data.retry_after_ms != null) {
        return {
          ...entry,
          status: 'rate_limited',
          retryAfterMs: data.retry_after_ms,
        };
      }
      return {
        ...entry,
        status: 'error',
        error: data.message,
        errorTitle: data.title ?? null,
        errorHint: data.hint ?? null,
      };
    }
  }
  return entry;
}

/** Clear streaming buffers without touching status/sessionId/compactWarning. */
export function clearStreamBuffers(entry: StreamEntry): StreamEntry {
  return {
    ...entry,
    currentText: '',
    currentReasoning: '',
    currentArtifacts: [],
    currentCharts: [],
    currentToolCalls: [],
    cacheHit: false,
    cacheFreshness: null,
    disambigOptions: null,
    abort: null,
  };
}
