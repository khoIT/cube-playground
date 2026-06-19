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
import { chatHeaders } from '../../../api/chat-auth-headers';
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
    let found = s.streams.get(resolved) ?? null;
    // Stale-alias guard: the alias map records `realSessionId → '__new__'` for
    // every chat created this session and is never pruned. The shared __new__
    // entry's `sessionId` only reflects the MOST RECENT new chat, so an older
    // real id resolves here to a different session's id. Returning it would
    // leak that id into streamSessionId — bouncing the route to the latest
    // session and merging sends into the wrong thread. Honor the alias only
    // when the resolved entry is genuinely for the requested session.
    if (sessionId !== null && found && found.sessionId !== sessionId) {
      found = s.streams.get(sessionId) ?? null;
    }
    // On the new-chat surface (sessionId === null), the __new__ slot may
    // still hold a previous chat's terminal-state entry — its sessionId
    // field is the prior session's id. Returning it here would leak that
    // id into liveSessionIdRef and merge the next submit into the prior
    // session. Treat the slot as empty unless a stream is actually in
    // flight for it.
    if (sessionId === null && found && found.sessionId !== null) {
      const inFlight = found.status === 'loading' || found.status === 'streaming';
      if (!inFlight) return null;
    }
    return found;
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
    async (message: string, bypassCache?: boolean, webSearch?: boolean, researchMode?: boolean) => {
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
        webSearch,
        researchMode,
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

  // Wipe the live entry back to idle. Used to reconcile a zombie stream whose
  // turn already finished server-side (a dead socket never delivered `done`),
  // so the stale spinner/ghost bubble clears once the DB shows it complete.
  const resetStream = useCallback(() => {
    useChatStreamStore.getState().reset(liveSessionIdRef.current);
  }, []);

  // Re-fires session-changed event so useChatSession / rails refetch persisted
  // history. Preserved from the legacy hook for the "Reconnect" CTA.
  const reconnect = useCallback(async () => {
    const sid = liveSessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/chat/sessions/${sid}`, {
        headers: chatHeaders({ Accept: 'application/json' }),
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
    /** Phase 04 — addressable for the server-side cancel endpoint. */
    turnId: entry?.turnId ?? null,
    currentText: entry?.currentText ?? '',
    currentReasoning: entry?.currentReasoning ?? '',
    currentArtifacts: entry?.currentArtifacts ?? [],
    currentCharts: entry?.currentCharts ?? [],
    currentProposals: entry?.currentProposals ?? [],
    currentToolCalls: entry?.currentToolCalls ?? [],
    cacheHit: entry?.cacheHit ?? false,
    cacheFreshness: entry?.cacheFreshness ?? null,
    disambigOptions: entry?.disambigOptions ?? null,
    /** Phase 04 — populated when `turn_aborted` lands. */
    abort: entry?.abort ?? null,
    error: entry?.error ?? null,
    errorTitle: entry?.errorTitle ?? null,
    errorHint: entry?.errorHint ?? null,
    lastCompactWarning: entry?.lastCompactWarning ?? null,
    retryAfterMs: entry?.retryAfterMs ?? null,
    sendTurn,
    cancel,
    reconnect,
    clearStreamBuffers,
    resetStream,
  };
}
