/**
 * Chat stream reducer — state shape, action union, and pure reducer function.
 * Separated from the hook so the hook file stays under 200 lines.
 */
import type { QueryArtifact } from '../../../api/chat-sse-client';

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

export interface StreamState {
  status: StreamStatus;
  sessionId: string | null;
  currentText: string;
  currentReasoning: string;
  currentArtifacts: QueryArtifact[];
  currentToolCalls: ToolCallState[];
  error: string | null;
  lastCompactWarning: CompactWarning | null;
  retryAfterMs: number | null;
}

export type StreamAction =
  | { type: 'START'; sessionId: string | null }
  | { type: 'SESSION_CREATED'; id: string }
  | { type: 'LOADING' }
  | { type: 'STREAMING' }
  | { type: 'TOKEN'; delta: string }
  | { type: 'THINKING'; delta: string }
  | { type: 'TOOL_CALL'; id: string; name: string; args: unknown }
  | { type: 'TOOL_RESULT'; id: string; ok: boolean; ms: number; summary: string }
  | { type: 'ARTIFACT'; artifact: QueryArtifact }
  | { type: 'COMPACT_WARNING'; from: string; to: string; summary: string }
  | { type: 'DONE' }
  | { type: 'ERROR'; message: string }
  | { type: 'DISCONNECTED' }
  | { type: 'RATE_LIMITED'; retryAfterMs: number }
  | { type: 'RESET' };

export function makeInitialStreamState(sessionId: string | null): StreamState {
  return {
    status: 'idle',
    sessionId,
    currentText: '',
    currentReasoning: '',
    currentArtifacts: [],
    currentToolCalls: [],
    error: null,
    lastCompactWarning: null,
    retryAfterMs: null,
  };
}

export function chatStreamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'START':
      return {
        ...makeInitialStreamState(action.sessionId),
        status: 'loading',
        lastCompactWarning: state.lastCompactWarning,
      };

    case 'SESSION_CREATED':
      return { ...state, sessionId: action.id };

    case 'LOADING':
      return { ...state, status: 'loading' };

    case 'STREAMING':
      return { ...state, status: 'streaming' };

    case 'TOKEN':
      return { ...state, status: 'streaming', currentText: state.currentText + action.delta };

    case 'THINKING':
      return { ...state, currentReasoning: state.currentReasoning + action.delta };

    case 'TOOL_CALL': {
      if (state.currentToolCalls.find((t) => t.id === action.id)) return state;
      return {
        ...state,
        currentToolCalls: [
          ...state.currentToolCalls,
          { id: action.id, name: action.name, args: action.args, status: 'pending' },
        ],
      };
    }

    case 'TOOL_RESULT':
      return {
        ...state,
        currentToolCalls: state.currentToolCalls.map((t) =>
          t.id === action.id
            ? { ...t, status: action.ok ? 'ok' : 'error', ms: action.ms, summary: action.summary }
            : t,
        ),
      };

    case 'ARTIFACT':
      return { ...state, currentArtifacts: [...state.currentArtifacts, action.artifact] };

    case 'COMPACT_WARNING':
      return {
        ...state,
        sessionId: action.to,
        lastCompactWarning: { from: action.from, to: action.to, summary: action.summary },
      };

    case 'DONE':
      return { ...state, status: 'done' };

    case 'ERROR':
      return { ...state, status: 'error', error: action.message };

    case 'DISCONNECTED':
      return { ...state, status: 'disconnected' };

    case 'RATE_LIMITED':
      return { ...state, status: 'rate_limited', retryAfterMs: action.retryAfterMs };

    case 'RESET':
      return makeInitialStreamState(state.sessionId);

    default:
      return state;
  }
}
