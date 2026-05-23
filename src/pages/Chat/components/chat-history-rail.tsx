/**
 * ChatHistoryRail — left panel on the /chat landing page listing recent sessions.
 * Width: 280px fixed. Refetches on gds-cube:chat-session-changed events.
 */
import React from 'react';
import { T } from '../../../shell/theme';
import { useChatSessionsList } from '../hooks/use-chat-sessions-list';
import { SessionRow } from './session-row';

interface ChatHistoryRailProps {
  activeId?: string;
}

export function ChatHistoryRail({ activeId }: ChatHistoryRailProps) {
  const { sessions, isLoading } = useChatSessionsList();

  return (
    <div
      data-testid="chat-history-rail"
      style={{
        width: 280,
        flexShrink: 0,
        height: '100%',
        borderRight: `1px solid ${T.n200}`,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        padding: '12px 8px',
        gap: 2,
      }}
    >
      <div
        style={{
          fontFamily: T.fMono,
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: T.n400,
          padding: '4px 8px 8px',
        }}
      >
        Recent conversations
      </div>

      {isLoading && (
        <div style={{ padding: '8px 12px', fontFamily: T.fSans, fontSize: 13, color: T.n400 }}>
          Loading…
        </div>
      )}

      {!isLoading && sessions.length === 0 && (
        <div style={{ padding: '8px 12px', fontFamily: T.fSans, fontSize: 13, color: T.n400 }}>
          No conversations yet
        </div>
      )}

      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          active={session.id === activeId}
        />
      ))}
    </div>
  );
}
