/**
 * SidebarChatRecents — chat tray rows sourced from the server sessions list
 * (not localStorage). The previous localStorage-backed RecentItems only saw
 * sessions whose final DONE event was observed in this browser, which made
 * the sidebar drift behind server truth (e.g. cross-browser, cross-tab,
 * sessions created before pushRecent ran). This component mirrors what the
 * /chat history rail shows, scoped to the active game.
 */
import React from 'react';
import { useHistory, useRouteMatch } from 'react-router-dom';
import { SidebarItem } from './sidebar-item';
import { useChatSessionsList } from '../../pages/Chat/hooks/use-chat-sessions-list';
import { openChatSearch } from '../../shared/chat-search/chat-search-store';
import { ChatRowKebabMenu } from '../../shared/chat-recents/chat-row-kebab-menu';

const VISIBLE = 6;

export function SidebarChatRecents() {
  const { sessions, isLoading, error } = useChatSessionsList();
  const history = useHistory();
  const match = useRouteMatch<{ id?: string }>('/chat/:id');
  const activeChatId = match?.params?.id;

  if (error) {
    return <SidebarItem label="Couldn't load chats" to="/chat" indent muted />;
  }

  if (isLoading && sessions.length === 0) {
    return <SidebarItem label="Loading…" to="/chat" indent muted />;
  }

  if (sessions.length === 0) {
    return <SidebarItem label="No conversations yet" to="/chat" indent muted />;
  }

  // If the user deletes the conversation they're currently viewing, bounce
  // back to /chat so the route doesn't 404 on the next fetch.
  function handleDeleted(deletedId: string) {
    if (activeChatId === deletedId) {
      history.push('/chat');
    }
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
          trailingShowOnHover
          trailing={
            <ChatRowKebabMenu
              sessionId={s.id}
              sessionTitle={s.title}
              onDeleted={handleDeleted}
            />
          }
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
