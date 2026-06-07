/**
 * Single row in the /dev/chat-audit session list.
 * Renders title + meta line, plus a checkbox prefix when the row is
 * soft-deleted so the operator can build a bulk-action selection.
 */
import React from 'react';
import { T } from '../../shell/theme';
import type { DebugSession } from './use-debug-api';

interface SessionListRowProps {
  session: DebugSession;
  active: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
  /** Admin all-users scope: show whose session each row is. */
  showOwner?: boolean;
}

const S = {
  outer: (active: boolean, deleted: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    padding: '10px 14px',
    gap: 8,
    borderBottom: `1px solid ${T.n100}`,
    cursor: 'pointer',
    background: active ? T.brandSoft : deleted ? T.redSoft : 'transparent',
    borderLeft: active
      ? `3px solid ${T.brand}`
      : deleted
        ? `3px solid ${T.red500}`
        : '3px solid transparent',
    opacity: deleted ? 0.85 : 1,
  }),
  body: { flex: 1, minWidth: 0 } as React.CSSProperties,
  checkbox: { marginTop: 2, cursor: 'pointer' } as React.CSSProperties,
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: T.n800,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  deletedBadge: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: T.red600,
    background: T.redSoft,
    border: `1px solid ${T.red500}`,
    borderRadius: 3,
    padding: '1px 4px',
    flexShrink: 0,
  } as React.CSSProperties,
  meta: {
    fontSize: 11,
    color: T.n500,
    marginTop: 2,
    display: 'flex',
    gap: 10,
  } as React.CSSProperties,
};

function relativeTime(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SessionListRow({
  session,
  active,
  selected,
  onSelect,
  onToggleSelected,
  showOwner,
}: SessionListRowProps) {
  const isDeleted = session.deletedAt != null;
  return (
    <div
      style={S.outer(active, isDeleted)}
      onClick={() => onSelect(session.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(session.id)}
    >
      {isDeleted && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(session.id)}
          onClick={(e) => e.stopPropagation()}
          style={S.checkbox}
          aria-label={`Select deleted session ${session.title || session.id}`}
          data-testid={`deleted-row-checkbox-${session.id}`}
        />
      )}
      <div style={S.body}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={S.title}>{session.title || `Session ${session.id.slice(0, 8)}`}</div>
          {isDeleted && <span style={S.deletedBadge}>Deleted</span>}
        </div>
        <div style={S.meta}>
          {showOwner && (
            // Owner subs are emails in dev mode / KC UUIDs in real auth — show
            // the local-part for emails, a short prefix otherwise.
            <span style={{ color: T.n600, fontWeight: 600 }} title={session.owner_id}>
              {session.owner_id.includes('@') ? session.owner_id.split('@')[0] : session.owner_id.slice(0, 8)}
            </span>
          )}
          <span>{session.turn_count} turn{session.turn_count !== 1 ? 's' : ''}</span>
          <span>{relativeTime(session.last_turn_at ?? session.created_at)}</span>
          {session.status !== 'active' && !isDeleted && (
            <span style={{ color: T.n400 }}>{session.status}</span>
          )}
          {isDeleted && (
            <span style={{ color: T.red600 }}>deleted {relativeTime(session.deletedAt)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
