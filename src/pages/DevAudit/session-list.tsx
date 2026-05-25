/**
 * SessionList — left pane of the /dev/chat-audit triage UI.
 * Renders a searchable list of sessions for the active game.
 * Search is debounced 300ms to avoid hammering the backend.
 */
import React, { useState, useEffect, useRef } from 'react';
import { T } from '../../shell/theme';
import { useDebugSessions, DebugSession } from './use-debug-api';

interface SessionListProps {
  gameId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const S = {
  root: {
    width: 340,
    minWidth: 280,
    display: 'flex',
    flexDirection: 'column' as const,
    borderRight: `1px solid ${T.n200}`,
    height: '100%',
    overflow: 'hidden',
  } as React.CSSProperties,
  searchWrap: {
    padding: '10px 12px',
    borderBottom: `1px solid ${T.n200}`,
    flexShrink: 0,
  } as React.CSSProperties,
  searchInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '5px 10px',
    border: `1px solid ${T.n300}`,
    borderRadius: 6,
    fontSize: 12,
    fontFamily: T.fSans,
    outline: 'none',
    background: T.surface,
    color: T.n800,
  } as React.CSSProperties,
  list: {
    flex: 1,
    overflowY: 'auto' as const,
  } as React.CSSProperties,
  row: (active: boolean): React.CSSProperties => ({
    padding: '10px 14px',
    borderBottom: `1px solid ${T.n100}`,
    cursor: 'pointer',
    background: active ? T.brandSoft : 'transparent',
    borderLeft: active ? `3px solid ${T.brand}` : '3px solid transparent',
  }),
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: T.n800,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  meta: {
    fontSize: 11,
    color: T.n500,
    marginTop: 2,
    display: 'flex',
    gap: 10,
  } as React.CSSProperties,
  emptyState: {
    padding: '32px 20px',
    textAlign: 'center' as const,
    color: T.n400,
    fontSize: 12,
  } as React.CSSProperties,
  errorBanner: {
    margin: '8px 12px',
    padding: '6px 10px',
    background: T.redSoft,
    border: `1px solid ${T.red500}`,
    borderRadius: 5,
    fontSize: 11,
    color: T.red600,
  } as React.CSSProperties,
  skeleton: {
    height: 58,
    margin: '2px 12px',
    borderRadius: 4,
    background: T.n100,
    animation: 'pulse 1.5s ease-in-out infinite',
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

export function SessionList({ gameId, selectedId, onSelect }: SessionListProps) {
  const [rawQ, setRawQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQ(rawQ), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [rawQ]);

  const { data, isLoading, error } = useDebugSessions({ game: gameId, q: debouncedQ });
  const sessions = data ?? [];

  return (
    <div style={S.root}>
      <div style={S.searchWrap}>
        <input
          type="search"
          placeholder="Search sessions…"
          value={rawQ}
          onChange={(e) => setRawQ(e.target.value)}
          style={S.searchInput}
        />
      </div>

      {error && <div style={S.errorBanner}>Error: {error}</div>}

      <div style={S.list}>
        {isLoading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={S.skeleton} />
        ))}

        {!isLoading && sessions.length === 0 && !error && (
          <div style={S.emptyState}>
            No sessions for this game yet.
            <br />
            <a href="#/build" style={{ color: T.brand, marginTop: 8, display: 'inline-block' }}>
              Go to Build
            </a>
          </div>
        )}

        {sessions.map((s: DebugSession) => (
          <div
            key={s.id}
            style={S.row(s.id === selectedId)}
            onClick={() => onSelect(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(s.id)}
          >
            <div style={S.title}>{s.title || `Session ${s.id.slice(0, 8)}`}</div>
            <div style={S.meta}>
              <span>{s.turn_count} turn{s.turn_count !== 1 ? 's' : ''}</span>
              <span>{relativeTime(s.last_turn_at ?? s.created_at)}</span>
              {s.status !== 'active' && <span style={{ color: T.n400 }}>{s.status}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
