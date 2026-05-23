/**
 * useChatStream — drives a live SSE turn against the chat-service proxy.
 *
 * Accumulates SSE events into displayable state:
 *   currentText        — token deltas concatenated
 *   currentReasoning   — thinking deltas concatenated
 *   currentArtifacts   — query_artifact events collected
 *   currentToolCalls   — tool_call / tool_result events merged
 *   status             — 'idle' | 'loading' | 'streaming' | 'done' | 'error'
 *   sessionId          — updated on session_created (starts from prop value)
 *
 * sendTurn(message) starts a new turn; cancel() aborts in-flight.
 */
import { useCallback, useReducer, useRef } from 'react';
import { openChatTurn, type QueryArtifact } from '../../../api/chat-sse-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export interface ToolCallState {
  id: string;
  name: string;
  args?: unknown;
  status: 'pending' | 'ok' | 'error';
  ms?: number;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

interface StreamState {
  status: StreamStatus;
  sessionId: string | null;
  currentText: string;
  currentReasoning: string;
  currentArtifacts: QueryArtifact[];
  currentToolCalls: ToolCallState[];
  error: string | null;
}

type StreamAction =
  | { type: 'START'; sessionId: string | null }
  | { type: 'SESSION_CREATED'; id: string }
  | { type: 'LOADING' }
  | { type: 'STREAMING' }
  | { type: 'TOKEN'; delta: string }
  | { type: 'THINKING'; delta: string }
  | { type: 'TOOL_CALL'; id: string; name: string; args: unknown }
  | { type: 'TOOL_RESULT'; id: string; ok: boolean; ms: number; summary: string }
  | { type: 'ARTIFACT'; artifact: QueryArtifact }
  | { type: 'DONE' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' };

function makeInitial(sessionId: string | null): StreamState {
  return {
    status: 'idle',
    sessionId,
    currentText: '',
    currentReasoning: '',
    currentArtifacts: [],
    currentToolCalls: [],
    error: null,
  };
}

function reducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'START':
      return {
        ...makeInitial(action.sessionId),
        status: 'loading',
      };

    case 'SESSION_CREATED':
      return { ...state, sessionId: action.id };

    case 'LOADING':
      return { ...state, status: 'loading' };

    case 'STREAMING':
      return { ...state, status: 'streaming' };

    case 'TOKEN':
      return {
        ...state,
        status: 'streaming',
        currentText: state.currentText + action.delta,
      };

    case 'THINKING':
      return {
        ...state,
        currentReasoning: state.currentReasoning + action.delta,
      };

    case 'TOOL_CALL': {
      const existing = state.currentToolCalls.find((t) => t.id === action.id);
      if (existing) return state;
      return {
        ...state,
        currentToolCalls: [
          ...state.currentToolCalls,
          { id: action.id, name: action.name, args: action.args, status: 'pending' },
        ],
      };
    }

    case 'TOOL_RESULT': {
      return {
        ...state,
        currentToolCalls: state.currentToolCalls.map((t) =>
          t.id === action.id
            ? { ...t, status: action.ok ? 'ok' : 'error', ms: action.ms, summary: action.summary }
            : t,
        ),
      };
    }

    case 'ARTIFACT':
      return {
        ...state,
        currentArtifacts: [...state.currentArtifacts, action.artifact],
      };

    case 'DONE':
      return { ...state, status: 'done' };

    case 'ERROR':
      return { ...state, status: 'error', error: action.message };

    case 'RESET':
      return makeInitial(state.sessionId);

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseChatStreamOptions {
  sessionId: string | null;
  game: string;
}

export function useChatStream({ sessionId, game }: UseChatStreamOptions) {
  const [state, dispatch] = useReducer(reducer, makeInitial(sessionId));

  // Track mutable sessionId across renders without triggering re-render.
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = state.sessionId ?? sessionId;

  // Hold the cancel fn for the current turn so cancel() can reach it.
  const cancelRef = useRef<(() => void) | null>(null);

  const sendTurn = useCallback(
    async (message: string) => {
      // Cancel any in-flight turn.
      cancelRef.current?.();

      dispatch({ type: 'START', sessionId: sessionIdRef.current });

      const { stream, cancel } = openChatTurn({
        sessionId: sessionIdRef.current,
        message,
        game,
      });
      cancelRef.current = cancel;

      try {
        for await (const event of stream) {
          switch (event.type) {
            case 'session_created':
              sessionIdRef.current = event.data.id;
              dispatch({ type: 'SESSION_CREATED', id: event.data.id });
              break;
            case 'loading':
              dispatch({ type: 'LOADING' });
              break;
            case 'thinking':
              dispatch({ type: 'THINKING', delta: event.data.delta });
              break;
            case 'tool_call':
              dispatch({
                type: 'TOOL_CALL',
                id: event.data.id,
                name: event.data.name,
                args: event.data.args,
              });
              break;
            case 'tool_result':
              dispatch({
                type: 'TOOL_RESULT',
                id: event.data.id,
                ok: event.data.ok,
                ms: event.data.ms,
                summary: event.data.summary,
              });
              break;
            case 'token':
              dispatch({ type: 'TOKEN', delta: event.data.delta });
              break;
            case 'query_artifact':
              dispatch({ type: 'ARTIFACT', artifact: event.data });
              break;
            case 'result':
              // result carries final text; if currentText is empty (no token events),
              // use result.text directly.
              if (event.data.text && !state.currentText) {
                dispatch({ type: 'TOKEN', delta: event.data.text });
              }
              break;
            case 'error':
              dispatch({ type: 'ERROR', message: event.data.message });
              break;
            case 'done':
              dispatch({ type: 'DONE' });
              break;
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          dispatch({ type: 'ERROR', message: err.message });
        }
      } finally {
        cancelRef.current = null;
      }
    },
    [game], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    dispatch({ type: 'RESET' });
  }, []);

  return {
    status: state.status,
    sessionId: state.sessionId,
    currentText: state.currentText,
    currentReasoning: state.currentReasoning,
    currentArtifacts: state.currentArtifacts,
    currentToolCalls: state.currentToolCalls,
    error: state.error,
    sendTurn,
    cancel,
  };
}
