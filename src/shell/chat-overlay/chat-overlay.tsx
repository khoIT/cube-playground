/**
 * ChatOverlay — mounted once near the App root as a side-effect host.
 *
 * The Ask Cube button now lives in the Topbar (src/shell/topbar/topbar.tsx);
 * this component only listens for game-change events: switching game closes
 * the panel and clears the active session so the new game's context starts
 * fresh.
 */
import { useEffect } from 'react';
import { setOpen } from './chat-panel-open-store';
import { setActiveChatSession } from './use-active-chat-session';

export function ChatOverlay() {
  useEffect(() => {
    const handler = () => {
      setOpen(false);
      setActiveChatSession(null);
    };
    window.addEventListener('gds-cube:game-change', handler);
    return () => window.removeEventListener('gds-cube:game-change', handler);
  }, []);

  return null;
}
