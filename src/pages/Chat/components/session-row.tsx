/**
 * SessionRow — single line in the chat history rail or list.
 * Shows truncated title + relative timestamp. Highlights when active.
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import { T } from '../../../shell/theme';
import type { SessionSummary } from '../hooks/use-chat-sessions-list';

const TITLE_MAX = 48;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

interface SessionRowProps {
  session: SessionSummary;
  active?: boolean;
}

export function SessionRow({ session, active = false }: SessionRowProps) {
  const history = useHistory();

  return (
    <button
      type="button"
      data-testid={`session-row-${session.id}`}
      onClick={() => history.push(`/chat/${session.id}`)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '8px 12px',
        border: 'none',
        borderRadius: 8,
        background: active ? T.brandSoft : 'none',
        cursor: 'pointer',
        textAlign: 'left',
        gap: 8,
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = T.surfaceSubtle;
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'none';
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: T.fSans,
          fontSize: 13,
          color: active ? T.brand : T.n800,
          fontWeight: active ? 600 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {truncate(session.title || 'Untitled', TITLE_MAX)}
      </span>
      <span
        style={{
          flexShrink: 0,
          fontFamily: T.fSans,
          fontSize: 11,
          color: T.n400,
          whiteSpace: 'nowrap',
        }}
      >
        {relativeTime(session.updatedAt ?? session.createdAt)}
      </span>
    </button>
  );
}
