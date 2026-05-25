/**
 * DevAuditPage — route component for /dev/chat-audit.
 * Internal triage tool: session list (left) + session/turn detail (right).
 * Data is always scoped to the current owner via X-Owner-Id header.
 */
import React from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { SessionList } from './session-list';
import { SessionDetail } from './session-detail';

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    fontFamily: T.fSans,
    background: T.surface,
    overflow: 'hidden',
  } as React.CSSProperties,
  banner: {
    flexShrink: 0,
    padding: '6px 16px',
    background: T.surfaceSubtle,
    borderBottom: `1px solid ${T.n200}`,
    fontSize: 11,
    color: T.n600,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  } as React.CSSProperties,
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'row' as const,
    overflow: 'hidden',
    minHeight: 0,
  } as React.CSSProperties,
};

export function DevAuditPage() {
  const gameId = useActiveGameId();
  // Session id is part of the URL so the link is shareable / bookmarkable.
  // /dev/chat-audit             → no selection
  // /dev/chat-audit/:sessionId  → pre-select that session, also reflected
  //                               in the URL when the user clicks a row.
  const history = useHistory();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const selectedSessionId = routeSessionId ?? null;

  function setSelectedSessionId(id: string | null): void {
    history.replace(id ? `/dev/chat-audit/${id}` : '/dev/chat-audit');
  }

  return (
    <div style={S.root}>
      <div style={S.banner}>
        <span>Showing your own chat sessions for triage.</span>
        <span style={{ marginLeft: 'auto', color: T.n500, fontFamily: T.fMono }}>
          game: {gameId}
        </span>
      </div>

      <div style={S.body}>
        <SessionList
          gameId={gameId}
          selectedId={selectedSessionId}
          onSelect={setSelectedSessionId}
        />
        <SessionDetail sessionId={selectedSessionId} />
      </div>
    </div>
  );
}
