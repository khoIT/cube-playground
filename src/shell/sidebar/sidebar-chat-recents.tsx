/**
 * SidebarChatRecents — chat tray rows sourced from the server sessions list
 * (not localStorage). The previous localStorage-backed RecentItems only saw
 * sessions whose final DONE event was observed in this browser, which made
 * the sidebar drift behind server truth (e.g. cross-browser, cross-tab,
 * sessions created before pushRecent ran). This component mirrors what the
 * /chat history rail shows, scoped to the active game.
 *
 * Also renders a "Shared with team" group below the user's own recents,
 * listing up to 6 sessions published by other team members.
 */
import React from 'react';
import { useHistory, useRouteMatch } from 'react-router-dom';
import { SidebarItem } from './sidebar-item';
import { useChatSessionsList } from '../../pages/Chat/hooks/use-chat-sessions-list';
import { openChatSearch } from '../../shared/chat-search/chat-search-store';
import { ChatRowKebabMenu } from '../../shared/chat-recents/chat-row-kebab-menu';
import { T } from '../theme';

const VISIBLE = 6;

/** Section heading for the "Shared with team" group — matches the muted
 *  eyebrow style used on other grouped sidebar sections. */
function SharedSectionHeading() {
  return (
    <div
      style={{
        padding: '8px 12px 2px 16px',
        fontFamily: T.fSans,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: T.n500,
        userSelect: 'none',
      }}
    >
      Shared with team
    </div>
  );
}

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
  const shownShared = sharedSessions.slice(0, VISIBLE);

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

  return (
    <>
      {ownSection}

      {/* Shared-with-team group — rendered whenever the team has published
          sessions, independent of the viewer's own-list state. No kebab menus
          here since these sessions are not owned by the viewer. */}
      {shownShared.length > 0 && (
        <>
          <SharedSectionHeading />
          {shownShared.map((s) => (
            <SidebarItem
              key={s.id}
              label={s.ownerLabel ? `${s.title || 'Chat'} · by ${s.ownerLabel}` : (s.title || 'Chat')}
              to={`/chat/${s.id}`}
              indent
              muted
            />
          ))}
        </>
      )}
    </>
  );
}
