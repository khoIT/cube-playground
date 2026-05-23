/**
 * useChatSurfaces — single source of truth for which chat surface is visible.
 *
 * Returns three mutually-exclusive booleans:
 *   pageVisible  — user is on /chat or /chat/:id; neither FAB nor panel renders
 *   panelVisible — user is on any other route AND panel is open
 *   fabVisible   — user is on any other route AND panel is closed
 */
import { useLocation } from 'react-router-dom';
import { useChatPanelOpen } from './chat-panel-open-store';

interface ChatSurfaces {
  fabVisible: boolean;
  panelVisible: boolean;
  pageVisible: boolean;
}

export function useChatSurfaces(): ChatSurfaces {
  const { pathname } = useLocation();
  const panelOpen = useChatPanelOpen();

  const isChatPage = pathname === '/chat' || pathname.startsWith('/chat/');

  if (isChatPage) {
    return { pageVisible: true, panelVisible: false, fabVisible: false };
  }

  if (panelOpen) {
    return { pageVisible: false, panelVisible: true, fabVisible: false };
  }

  return { pageVisible: false, panelVisible: false, fabVisible: true };
}
