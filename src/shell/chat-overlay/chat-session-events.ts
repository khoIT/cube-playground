/**
 * Cross-surface DOM events for chat session lifecycle.
 * Uses CustomEvent on window so any mounted component can subscribe without
 * direct import coupling to the panel or stream hook.
 */

const EVENT = 'gds-cube:chat-session-changed';

/** Fire when a turn finishes and a session id is known. */
export function notifyChatSessionChanged(sessionId: string): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { sessionId } }));
  } catch { /* noop — SSR / test env */ }
}

/** Subscribe to session-changed events. Returns an unsubscribe fn. */
export function onChatSessionChanged(cb: (sessionId: string) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ sessionId: string }>).detail;
    if (detail?.sessionId) cb(detail.sessionId);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
