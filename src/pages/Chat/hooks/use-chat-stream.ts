/**
 * useChatStream — selector + subscribe lifecycle over the singleton
 * `chat-stream-store`. Exposes the same field shape consumers used to read
 * from the old `useReducer` version so the panel and `/chat/:id` view stay
 * source-compatible.
 *
 * Subscribe semantics: refcount only. Unmount NEVER cancels the live fetch —
 * the stream keeps running and re-mount picks up the same slice from the
 * store. Explicit cancellation is the "Stop generating" button only.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useChatStreamStore } from '../../../stores/chat-stream-store';
import type {
  StreamStatus,
  ToolCallState,
  CompactWarning,
} from '../../../stores/chat-stream-store';
import { getOwnerId } from '../../../api/chat-owner-id';
import { notifyChatSessionChanged } from '../../../shell/chat-overlay/chat-session-events';

export type { StreamStatus, ToolCallState, CompactWarning };

interface UseChatStreamOptions {
  sessionId: string | null;
  game: string;
}

export function useChatStream({ sessionId, game }: UseChatStreamOptions) {
  // The session id that drives streaming may differ from the prop after
  // session_created / compact_warning. Track it locally so cancel + sendTurn
  // hit the right slice without forcing a re-subscribe.
  const liveSessionIdRef = useRef<string | null>(sessionId);

  // Subscribe to the entry for the *current* prop sessionId. The store keeps
  // entries at their original key (e.g. `__new__` for new sessions) and uses
  // an alias map to resolve subsequent session ids back to the same entry, so
  // both views see the same slice even after `session_created` advances the
  // sessionId.
  const entry = useChatStreamStore((s) => {
    const key = sessionId ?? '__new__';
    const resolved = s.aliases.get(key) ?? key;
    return s.streams.get(resolved) ?? null;
  });

  // Mirror the live session id (post session_created) for cancel/sendTurn.
  useEffect(() => {
    liveSessionIdRef.current = entry?.sessionId ?? sessionId;
  }, [entry?.sessionId, sessionId]);

  // Subscribe on mount, unsubscribe on unmount. Refcount only.
  useEffect(() => {
    const store = useChatStreamStore.getState();
    store.subscribe(sessionId);
    return () => {
      useChatStreamStore.getState().unsubscribe(sessionId);
    };
  }, [sessionId]);

  const sendTurn = useCallback(
    async (message: string, bypassCache?: boolean) => {
      // Touch ownerId so the SSE fetch picks up the current user header.
      // (openChatTurn reads it internally; this is just to keep parity with
      //  the previous hook for tests that mock getOwnerId.)
      void getOwnerId();
      // Lazy import keeps the panel-only mode override out of the bundle for
      // routes that never mount the chat panel.
      const { getEffectiveChatMode } = await import(
        '../../../shell/chat-overlay/use-session-mode-override'
      );
      await useChatStreamStore.getState().startTurn({
        sessionId: liveSessionIdRef.current,
        message,
        game,
        mode: getEffectiveChatMode(liveSessionIdRef.current),
        bypassCache,
      });
    },
    [game],
  );

  const cancel = useCallback(() => {
    useChatStreamStore.getState().cancel(liveSessionIdRef.current);
  }, []);

  const clearStreamBuffers = useCallback(() => {
    useChatStreamStore.getState().clearBuffers(liveSessionIdRef.current);
  }, []);

  // Re-fires session-changed event so useChatSession / rails refetch persisted
  // history. Preserved from the legacy hook for the "Reconnect" CTA.
  const reconnect = useCallback(async () => {
    const sid = liveSessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/chat/sessions/${sid}`, {
        headers: { Accept: 'application/json', 'X-Owner-Id': getOwnerId() },
      });
      if (res.ok) notifyChatSessionChanged(sid);
    } catch {
      /* swallow — caller can retry */
    }
    useChatStreamStore.getState().reset(sid);
  }, []);

  // Provide the same field shape as the old hook (defaults when no entry yet).
  const status: StreamStatus = entry?.status ?? 'idle';
  return {
    status,
    sessionId: entry?.sessionId ?? sessionId,
    currentText: entry?.currentText ?? '',
    currentReasoning: entry?.currentReasoning ?? '',
    currentArtifacts: entry?.currentArtifacts ?? [],
    currentCharts: entry?.currentCharts ?? [],
    currentToolCalls: entry?.currentToolCalls ?? [],
    error: entry?.error ?? null,
    lastCompactWarning: entry?.lastCompactWarning ?? null,
    retryAfterMs: entry?.retryAfterMs ?? null,
    sendTurn,
    cancel,
    reconnect,
    clearStreamBuffers,
  };
}
