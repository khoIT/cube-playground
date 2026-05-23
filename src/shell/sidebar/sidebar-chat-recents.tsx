/**
 * SidebarChatRecents — chat tray rows sourced from the server sessions list
 * (not localStorage). The previous localStorage-backed RecentItems only saw
 * sessions whose final DONE event was observed in this browser, which made
 * the sidebar drift behind server truth (e.g. cross-browser, cross-tab,
 * sessions created before pushRecent ran). This component mirrors what the
 * /chat history rail shows, scoped to the active game.
 */
import React from 'react';
import { SidebarItem } from './sidebar-item';
import { useChatSessionsList } from '../../pages/Chat/hooks/use-chat-sessions-list';
import { openChatSearch } from '../../shared/chat-search/chat-search-store';

const VISIBLE = 6;

export function SidebarChatRecents() {
  const { sessions, isLoading, error } = useChatSessionsList();

  if (error) {
    return <SidebarItem label="Couldn't load chats" to="/chat" indent muted />;
  }

  if (isLoading && sessions.length === 0) {
    return <SidebarItem label="Loading…" to="/chat" indent muted />;
  }

  if (sessions.length === 0) {
    return <SidebarItem label="No conversations yet" to="/chat" indent muted />;
  }

  const shown = sessions.slice(0, VISIBLE);
  return (
    <>
      {shown.map((s) => (
        <SidebarItem
          key={s.id}
          label={s.title || 'Chat'}
          to={`/chat/${s.id}`}
          indent
        />
      ))}
      {/* Always-present search trigger so users can find older conversations
          even when the visible tray already shows everything. */}
      <SidebarItem
        label={`See all… (${sessions.length})`}
        onClick={openChatSearch}
        indent
        muted
      />
    </>
  );
}
