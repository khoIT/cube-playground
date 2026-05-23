/**
 * useChatStream — drives a live SSE turn against the chat-service proxy.
 *
 * Exposes:
 *   status             — idle | loading | streaming | done | error | disconnected | rate_limited
 *   sessionId          — updated on session_created
 *   currentText / currentReasoning / currentArtifacts / currentToolCalls
 *   lastCompactWarning — set when compact_warning received; sessionId advances to 'to'
 *   retryAfterMs       — ms to wait on rate_limited
 *   sendTurn(msg)      — start a new turn
 *   cancel()           — abort in-flight turn
 *   reconnect()        — re-fetch session to refresh after disconnect
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { openChatTurn } from '../../../api/chat-sse-client';
import { getOwnerId } from '../../../api/chat-owner-id';
import { pushRecent } from '../../../shell/sidebar/recent-items-store';
import { notifyChatSessionChanged } from '../../../shell/chat-overlay/chat-session-events';
import {
  chatStreamReducer,
  makeInitialStreamState,
} from './use-chat-stream-reducer';

// Re-export types consumers depend on.
export type { StreamStatus, ToolCallState, CompactWarning } from './use-chat-stream-reducer';

interface UseChatStreamOptions {
  sessionId: string | null;
  game: string;
}

export function useChatStream({ sessionId, game }: UseChatStreamOptions) {
  const [state, dispatch] = useReducer(chatStreamReducer, makeInitialStreamState(sessionId));

  // Mutable sessionId — kept in sync without triggering re-renders.
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = state.sessionId ?? sessionId;

  const cancelRef = useRef<(() => void) | null>(null);
  const userMessageRef = useRef<string>('');

  // Resync when the parent changes sessionId externally (e.g. "New chat"
  // sets prop to null, user navigates to a different stored session).
  // Without this, RESET preserves state.sessionId and the next turn would
  // continue the previous session instead of starting a fresh one.
  useEffect(() => {
    if (state.sessionId !== sessionId) {
      cancelRef.current?.();
      cancelRef.current = null;
      dispatch({ type: 'EXTERNAL_RESET', sessionId });
    }
    // Intentionally depend only on the prop — internal state changes
    // (SESSION_CREATED bumping state.sessionId) shouldn't re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const sendTurn = useCallback(
    async (message: string) => {
      cancelRef.current?.();
      userMessageRef.current = message;
      dispatch({ type: 'START', sessionId: sessionIdRef.current });

      const { stream, cancel } = openChatTurn({
        sessionId: sessionIdRef.current,
        message,
        game,
      });
      cancelRef.current = cancel;

      let receivedDone = false;

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
              dispatch({ type: 'TOOL_CALL', id: event.data.id, name: event.data.name, args: event.data.args });
              break;
            case 'tool_result':
              dispatch({ type: 'TOOL_RESULT', id: event.data.id, ok: event.data.ok, ms: event.data.ms, summary: event.data.summary });
              break;
            case 'token':
              dispatch({ type: 'TOKEN', delta: event.data.delta });
              break;
            case 'query_artifact':
              dispatch({ type: 'ARTIFACT', artifact: event.data });
              break;
            case 'chart':
              dispatch({ type: 'CHART', artifact: event.data });
              break;
            case 'compact_warning':
              sessionIdRef.current = event.data.to;
              dispatch({ type: 'COMPACT_WARNING', from: event.data.from, to: event.data.to, summary: event.data.summary });
              break;
            case 'result':
              if (event.data.text && !state.currentText) {
                dispatch({ type: 'TOKEN', delta: event.data.text });
              }
              break;
            case 'error': {
              const errData = event.data as { code: string; retry_after_ms?: number; message: string };
              if (errData.code === 'rate_limited' && errData.retry_after_ms != null) {
                dispatch({ type: 'RATE_LIMITED', retryAfterMs: errData.retry_after_ms });
              } else {
                dispatch({ type: 'ERROR', message: errData.message });
              }
              break;
            }
            case 'done': {
              receivedDone = true;
              dispatch({ type: 'DONE' });
              const sid = sessionIdRef.current;
              if (sid) {
                const title = (userMessageRef.current || 'Chat').slice(0, 64);
                pushRecent('chat', { id: sid, title, updatedAt: new Date().toISOString(), href: `/chat/${sid}` });
                notifyChatSessionChanged(sid);
              }
              break;
            }
          }
        }
        // Stream ended without 'done' → connection dropped.
        if (!receivedDone) dispatch({ type: 'DISCONNECTED' });
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

  // Called by consumers after they've committed the streaming buffers into
  // their own persistent message list. Prevents the live preview from
  // re-rendering alongside the committed turn.
  const clearStreamBuffers = useCallback(() => {
    dispatch({ type: 'CLEAR_STREAM_BUFFERS' });
  }, []);

  // Re-fires session-changed event so useChatSession / rails refetch persisted history.
  const reconnect = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/chat/sessions/${sid}`, {
        headers: { Accept: 'application/json', 'X-Owner-Id': getOwnerId() },
      });
      if (res.ok) notifyChatSessionChanged(sid);
    } catch { /* silently ignore — caller can retry */ }
    dispatch({ type: 'RESET' });
  }, []);

  return {
    status: state.status,
    sessionId: state.sessionId,
    currentText: state.currentText,
    currentReasoning: state.currentReasoning,
    currentArtifacts: state.currentArtifacts,
    currentCharts: state.currentCharts,
    currentToolCalls: state.currentToolCalls,
    error: state.error,
    lastCompactWarning: state.lastCompactWarning,
    retryAfterMs: state.retryAfterMs,
    sendTurn,
    cancel,
    reconnect,
    clearStreamBuffers,
  };
}
