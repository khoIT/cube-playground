/**
 * SidebarChatRecents — chat tray rows sourced from the server sessions list
 * (not localStorage). The previous localStorage-backed RecentItems only saw
 * sessions whose final DONE event was observed in this browser, which made
 * the sidebar drift behind server truth (e.g. cross-browser, cross-tab,
 * sessions created before pushRecent ran). This component mirrors what the
 * /chat history rail shows, scoped to the active game.
 *
 * Sessions published by other team members render inline below the user's
 * own recents with a "Shared" pill — same pattern as the Segments section,
 * no separate heading. Owner attribution lives in the pill tooltip.
 */
import React from 'react';
import { useHistory, useRouteMatch } from 'react-router-dom';
import { SidebarItem } from './sidebar-item';
import { SharedPill } from './shared-pill';
import { useChatSessionsList } from '../../pages/Chat/hooks/use-chat-sessions-list';
import { openChatSearch } from '../../shared/chat-search/chat-search-store';
import { ChatRowKebabMenu } from '../../shared/chat-recents/chat-row-kebab-menu';

const VISIBLE = 6;

export function SidebarChatRecents() {
  const { sessions, isLoading, error } = useChatSessionsList();
  const { sessions: sharedSessions } = useChatSessionsList('', { shared: true });
  const history = useHistory();
  const match = useRouteMatch<{ id?: string }>('/chat/:id');
  const activeChatId = match?.params?.id;

  // If the user deletes the conversation they're currently viewing, bounce
  // back to /chat so the route doesn't 404 on the next fetch.
  function handleDeleted(deletedId: string) {
    if (activeChatId === deletedId) {
      history.push('/chat');
    }
  }

  const shown = sessions.slice(0, VISIBLE);
  // The shared listing has no owner exclusion server-side, so the viewer's
  // OWN published sessions come back in it too. Drop them — the pill means
  // "shared WITH me"; own sessions already render above with their kebab.
  const ownIds = new Set(sessions.map((s) => s.id));
  const shownShared = sharedSessions.filter((s) => !ownIds.has(s.id)).slice(0, VISIBLE);

  // The user's own recents. The empty/loading/error states only describe THIS
  // list — they must not suppress the shared group below (a brand-new teammate
  // with zero own chats should still see what the team has published).
  let ownSection: React.ReactNode;
  if (error) {
    ownSection = <SidebarItem label="Couldn't load chats" to="/chat" indent muted />;
  } else if (isLoading && sessions.length === 0) {
    ownSection = <SidebarItem label="Loading…" to="/chat" indent muted />;
  } else if (sessions.length === 0) {
    ownSection = <SidebarItem label="No conversations yet" to="/chat" indent muted />;
  } else {
    ownSection = (
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
      </>
    );
  }

  return (
    <>
      {ownSection}

      {/* Sessions shared by teammates, inline with the viewer's own recents.
          No kebab menus — these are not owned by the viewer. */}
      {shownShared.map((s) => (
        <SidebarItem
          key={s.id}
          label={s.title || 'Chat'}
          to={`/chat/${s.id}`}
          indent
          muted
          trailing={<SharedPill ownerLabel={s.ownerLabel} />}
        />
      ))}

      {/* Always-present search trigger so users can find older conversations
          even when the visible tray already shows everything. */}
      {!error && !(isLoading && sessions.length === 0) && sessions.length > 0 && (
        <SidebarItem
          label={`See all… (${sessions.length})`}
          onClick={openChatSearch}
          indent
          muted
        />
      )}
    </>
  );
}
