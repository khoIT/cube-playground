/**
 * SessionDetail — right pane of the /dev/chat-audit triage UI.
 * Shows session header metadata and a vertical turn timeline.
 * Each assistant turn renders a TurnDetail (expandable).
 */
import React from 'react';
import { T } from '../../shell/theme';
import { useDebugSession } from './use-debug-api';
import { TurnDetail } from './turn-detail';

interface SessionDetailProps {
  sessionId: string | null;
}

const S = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
    minWidth: 0,
  } as React.CSSProperties,
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: T.n400,
    fontSize: 13,
    fontFamily: T.fSans,
  } as React.CSSProperties,
  header: {
    padding: '12px 20px',
    borderBottom: `1px solid ${T.n200}`,
    flexShrink: 0,
  } as React.CSSProperties,
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  } as React.CSSProperties,
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: T.n900,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto 1fr',
    gap: '2px 12px',
    fontSize: 11,
    color: T.n600,
  } as React.CSSProperties,
  metaKey: { color: T.n400, fontWeight: 600 } as React.CSSProperties,
  metaVal: { fontFamily: T.fMono, color: T.n700 } as React.CSSProperties,
  timeline: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px 16px',
  } as React.CSSProperties,
  loading: {
    padding: '24px 20px',
    color: T.n400,
    fontSize: 12,
  } as React.CSSProperties,
  errorBanner: {
    margin: '12px 20px',
    padding: '8px 12px',
    background: T.redSoft,
    border: `1px solid ${T.red500}`,
    borderRadius: 6,
    fontSize: 12,
    color: T.red600,
  } as React.CSSProperties,
};

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const { data, isLoading, error } = useDebugSession(sessionId);

  if (!sessionId) {
    return (
      <div style={S.root}>
        <div style={S.empty}>Select a session to inspect</div>
      </div>
    );
  }

  return (
    <div style={S.root}>
      {isLoading && <div style={S.loading}>Loading session…</div>}
      {error && <div style={S.errorBanner}>Error: {error}</div>}

      {data && (
        <>
          <div style={S.header}>
            <div style={S.titleRow}>
              <div style={S.title}>
                {data.session.title || `Session ${data.session.id.slice(0, 12)}…`}
              </div>
              <span style={{ fontSize: 11, color: T.n400 }}>
                {data.turns.length} turn{data.turns.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={S.metaGrid}>
              <span style={S.metaKey}>ID</span>
              <span style={{ ...S.metaVal, fontSize: 10 }}>{data.session.id}</span>
              <span style={S.metaKey}>Game</span>
              <span style={S.metaVal}>{data.session.game_id}</span>
              <span style={S.metaKey}>Owner</span>
              <span style={S.metaVal}>{data.session.owner_id}</span>
              <span style={S.metaKey}>Created</span>
              <span style={S.metaVal}>{new Date(data.session.created_at).toLocaleString()}</span>
            </div>
          </div>

          <div style={S.timeline}>
            {data.turns.length === 0 && (
              <div style={{ color: T.n400, fontSize: 12 }}>No turns in this session.</div>
            )}
            {data.turns.map((turn, i) => (
              <TurnDetail key={turn.id} turn={turn} index={i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
