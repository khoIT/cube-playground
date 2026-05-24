/**
 * ChatOverlay — mounted once near the App root as a side-effect host.
 *
 * The Ask Cube button now lives in the Topbar (src/shell/topbar/topbar.tsx);
 * this component handles two route-driven side effects:
 *   1. Game-change events: switching game closes the panel and clears the
 *      active session so the new game's context starts fresh.
 *   2. Leaving /chat/:id for a non-chat route: auto-opens the side panel
 *      so the conversation the user just viewed continues alongside their
 *      next destination (Playground, Catalog, Segments, …).
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { setOpen } from './chat-panel-open-store';
import { setActiveChatSession } from './use-active-chat-session';

const CHAT_THREAD_PATH = /^\/chat\/([^/]+)$/;

export function ChatOverlay() {
  useEffect(() => {
    const handler = () => {
      setOpen(false);
      setActiveChatSession(null);
    };
    window.addEventListener('gds-cube:game-change', handler);
    return () => window.removeEventListener('gds-cube:game-change', handler);
  }, []);

  const { pathname } = useLocation();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = pathname;
    if (prev === null) return; // first render — no transition

    const prevMatch = prev.match(CHAT_THREAD_PATH);
    const nextOnChat = pathname === '/chat' || pathname.startsWith('/chat/');
    // Only auto-open when leaving a real thread (id present and not "new")
    // for a non-chat route. Set the panel's active session from the prev
    // route's id directly so we don't depend on a sibling effect having
    // already mirrored it (race / HMR safety).
    if (prevMatch && prevMatch[1] !== 'new' && !nextOnChat) {
      setActiveChatSession(prevMatch[1]);
      setOpen(true);
    }
  }, [pathname]);

  return null;
}
