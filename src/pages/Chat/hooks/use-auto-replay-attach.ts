/**
 * On mount (or when `activeTurnId` becomes known), attach to the chat-service
 * replay endpoint so refreshed clients pick up an in-flight turn. Idempotent:
 * the store's `attachReplay` itself no-ops when a stream for this session is
 * already active.
 */
import { useEffect, useRef } from 'react';
import { useChatStreamStore } from '../../../stores/chat-stream-store';

interface UseAutoReplayAttachOptions {
  sessionId: string | null;
  activeTurnId: string | null;
}

export function useAutoReplayAttach({
  sessionId,
  activeTurnId,
}: UseAutoReplayAttachOptions): void {
  const triggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !activeTurnId) return;
    // Avoid re-firing for the same turn during the same mount.
    if (triggeredRef.current === activeTurnId) return;
    triggeredRef.current = activeTurnId;
    void useChatStreamStore.getState().attachReplay(sessionId, activeTurnId, 0);
  }, [sessionId, activeTurnId]);
}
