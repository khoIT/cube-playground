/**
 * Phase 03 — exposes the current session focus bag for chips + Settings.
 *
 * Two sources feed the bag:
 *   1. Initial GET /api/chat/sessions/:id/focus on mount + sessionId change.
 *   2. SSE `focus_updated` / `focus_reset` events while a turn is streaming
 *      (surfaced via the chat-stream store's `latestFocus` slice).
 *
 * SSE has higher priority — the server is the source of truth, and the
 * `focus_updated` payload is the bag identical to what GET would return. The
 * hook also re-fetches when the turn completes so a non-streaming chip catches
 * any focus written without a live listener (e.g. background compact).
 *
 * Forget action: `forget()` calls the DELETE endpoint, then clears local
 * state immediately so the chip empties without waiting for a refetch.
 */
import { useCallback, useEffect, useState } from 'react';
import { useChatStreamStore } from '../../../stores/chat-stream-store';
import {
  deleteSessionFocus,
  getSessionFocus,
  type SessionFocusClient,
} from '../../../api/chat-session-focus-client';

export interface UseSessionFocus {
  /** Current focus bag — undefined when no session is active. */
  focus: SessionFocusClient | null;
  /** True while the initial GET is in flight. */
  loading: boolean;
  /** Phase 01 — true when an SDK resume id is persisted (powers the chip's "thread visible" hint). */
  hasSdkResume: boolean;
  refresh: () => Promise<void>;
  forget: () => Promise<boolean>;
}

export function useSessionFocus(sessionId: string | null): UseSessionFocus {
  const [focus, setFocus] = useState<SessionFocusClient | null>(null);
  const [hasSdkResume, setHasSdkResume] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // Subscribe to the latestFocus slot from the chat-stream store. Updates
  // arrive via the SSE reducer; the hook re-renders within React's normal
  // batching window (well under the 200ms target).
  const liveFocus = useChatStreamStore((s) => {
    if (!sessionId) return undefined;
    const key = sessionId;
    const resolved = s.aliases.get(key) ?? key;
    return s.streams.get(resolved)?.latestFocus;
  });

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setFocus(null);
      setHasSdkResume(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const snap = await getSessionFocus(sessionId);
    setFocus(snap?.focus ?? {});
    setHasSdkResume(snap?.hasSdkResume ?? false);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Prefer the SSE-pushed focus while it's present. liveFocus === null after
  // focus_reset → empty bag immediately, no refetch flash.
  const effective: SessionFocusClient | null =
    liveFocus !== undefined ? liveFocus : focus;

  const forget = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    const ok = await deleteSessionFocus(sessionId);
    if (ok) {
      setFocus({});
      setHasSdkResume(false);
    }
    return ok;
  }, [sessionId]);

  return { focus: effective, loading, hasSdkResume, refresh, forget };
}
