/**
 * ChatOverlay — mounted once near the App root.
 * Renders the AskCubeFab when the user is on a non-chat route with the panel
 * closed. The ChatPanel itself is a flex sibling in ShellLayout (push layout),
 * not rendered here.
 *
 * Also subscribes to game-change events: switching game closes the panel and
 * clears the active session so the new game's context starts fresh.
 */
import { useEffect } from 'react';
import { useChatSurfaces } from './use-chat-surfaces';
import { setOpen } from './chat-panel-open-store';
import { setActiveChatSession } from './use-active-chat-session';
import { AskCubeFab } from './ask-cube-fab';

export function ChatOverlay() {
  const { fabVisible, panelVisible } = useChatSurfaces();

  // Close panel and reset active session when the user switches games.
  useEffect(() => {
    const handler = () => {
      setOpen(false);
      setActiveChatSession(null);
    };
    window.addEventListener('gds-cube:game-change', handler);
    return () => window.removeEventListener('gds-cube:game-change', handler);
  }, []);

  if (!fabVisible) return null;

  return (
    <AskCubeFab
      onClick={() => setOpen(true)}
      panelVisible={panelVisible}
    />
  );
}
