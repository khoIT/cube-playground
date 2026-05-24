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
} from '../api/chat-sse-client';

export type StreamStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'done'
  | 'error'
  | 'disconnected'
  | 'rate_limited';

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
  lastCompactWarning: CompactWarning | null;
  retryAfterMs: number | null;
  refCount: number;
  /** Cancel handle for the live SSE fetch. */
  cancel?: () => void;
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

    case 'result':
      // `result` carries the final text snapshot; only fill if we never saw
      // streaming tokens (some skills emit a single result without tokens).
      if (event.data.text && !entry.currentText) {
        return { ...entry, currentText: event.data.text };
      }
      return entry;

    case 'done':
      return { ...entry, status: 'done' };

    case 'error': {
      const data = event.data as {
        code: string;
        message: string;
        retry_after_ms?: number;
      };
      if (data.code === 'rate_limited' && data.retry_after_ms != null) {
        return {
          ...entry,
          status: 'rate_limited',
          retryAfterMs: data.retry_after_ms,
        };
      }
      return { ...entry, status: 'error', error: data.message };
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
  };
}
