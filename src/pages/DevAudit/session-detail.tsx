/**
 * SessionDetail — right pane of the /dev/chat-audit triage UI.
 * Shows session header metadata and a vertical turn timeline.
 * Each assistant turn renders a TurnDetail (expandable).
 */
import React, { useCallback, useState } from 'react';
import { T } from '../../shell/theme';
import { useDebugSession, useRestoreSession } from './use-debug-api';
import { TurnDetail } from './turn-detail';
import { SkelText } from './skeleton-row';
import { EmptyState } from './empty-state';
import { AuthLanePill } from './auth-lane-pill';

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
    color: 'var(--shell-text-faint)',
    fontSize: 13,
    fontFamily: T.fSans,
  } as React.CSSProperties,
  header: {
    padding: '12px 20px',
    borderBottom: `1px solid var(--shell-border)`,
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
    color: 'var(--shell-text)',
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
    color: 'var(--shell-text-muted)',
  } as React.CSSProperties,
  metaKey: { color: 'var(--shell-text-faint)', fontWeight: 600 } as React.CSSProperties,
  metaVal: { fontFamily: T.fMono, color: 'var(--shell-text-secondary)' } as React.CSSProperties,
  timeline: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px 16px',
  } as React.CSSProperties,
  loading: {
    padding: '24px 20px',
    color: 'var(--shell-text-faint)',
    fontSize: 12,
  } as React.CSSProperties,
  errorBanner: {
    margin: '12px 20px',
    padding: '8px 12px',
    background: 'var(--shell-danger-soft)',
    border: `1px solid var(--shell-danger)`,
    borderRadius: 6,
    fontSize: 12,
    color: 'var(--shell-danger-strong)',
  } as React.CSSProperties,
};

export function SessionDetail({ sessionId }: SessionDetailProps) {
  // refreshTick increments after a successful restore to force re-fetch.
  const [refreshTick, setRefreshTick] = useState(0);
  const onRestoreSuccess = useCallback(() => setRefreshTick((t) => t + 1), []);
  const { restore, isLoading: isRestoring, error: restoreError } = useRestoreSession(onRestoreSuccess);
  const { data, isLoading, error } = useDebugSession(sessionId, refreshTick);

  if (!sessionId) {
    return (
      <div style={S.root}>
        <div style={S.empty}>Select a session to inspect</div>
      </div>
    );
  }

  return (
    <div style={S.root}>
      {isLoading && <SkelText n={5} padding={20} />}
      {error && <div style={S.errorBanner}>Error: {error}</div>}

      {data && (
        <>
          <div style={S.header}>
            {data.session.deletedAt != null && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 8,
                padding: '6px 10px',
                background: 'var(--shell-danger-soft)',
                border: `1px solid var(--shell-danger)`,
                borderRadius: 6,
              }}>
                <span style={{ fontSize: 11, color: 'var(--shell-danger-strong)', flex: 1 }}>
                  This session was soft-deleted and is pending purge.
                </span>
                <button
                  onClick={() => sessionId && restore(sessionId)}
                  disabled={isRestoring}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 4,
                    border: `1px solid var(--shell-brand)`,
                    background: 'var(--shell-brand-soft)',
                    color: 'var(--shell-brand)',
                    cursor: isRestoring ? 'not-allowed' : 'pointer',
                    opacity: isRestoring ? 0.6 : 1,
                  }}
                >
                  {isRestoring ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            )}
            {restoreError && (
              <div style={{ fontSize: 11, color: 'var(--shell-danger-strong)', marginBottom: 6 }}>
                Restore failed: {restoreError}
              </div>
            )}
            <div style={S.titleRow}>
              <div style={S.title}>
                {data.session.title || `Session ${data.session.id.slice(0, 12)}…`}
              </div>
              <AuthLanePill turns={data.turns} />
              <span style={{ fontSize: 11, color: 'var(--shell-text-faint)' }}>
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
              <EmptyState
                title="No turns in this session."
                description="Send a message to populate the turn timeline."
                testId="session-detail-no-turns"
              />
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
