/**
 * SearchResultsSessions — renders session search hits for the Search tab Sessions mode.
 *
 * Each row: session title (with query highlight), turn count, relative last-turn time,
 * deleted badge when applicable. Click → /dev/chat-audit/sessions/:id
 */

import React from 'react';
import { useHistory } from 'react-router-dom';
import { T } from '../../shell/theme';
import type { DebugSession } from './use-debug-api-types';

const S = {
  root: { flex: 1, overflowY: 'auto' as const } as React.CSSProperties,
  emptyState: {
    padding: '32px 20px',
    textAlign: 'center' as const,
    color: 'var(--shell-text-faint)',
    fontSize: 12,
  } as React.CSSProperties,
  skeleton: {
    height: 52,
    margin: '2px 12px',
    borderRadius: 4,
    background: 'var(--shell-bg-subtle)',
    marginBottom: 2,
  } as React.CSSProperties,
  errorBanner: {
    margin: '8px 12px',
    padding: '6px 10px',
    background: 'var(--shell-danger-soft)',
    border: `1px solid var(--shell-danger)`,
    borderRadius: 5,
    fontSize: 11,
    color: 'var(--shell-danger-strong)',
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    fontSize: 10.5,
    color: 'var(--shell-text-subtle)',
    fontWeight: 500,
    padding: '6px 8px',
    borderBottom: `1px solid var(--shell-border)`,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    fontFamily: T.fMono,
  } as React.CSSProperties,
  td: {
    padding: '8px',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
    fontSize: 12,
    color: 'var(--shell-text-emphasis)',
    verticalAlign: 'top' as const,
  } as React.CSSProperties,
  tdMono: {
    padding: '8px',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
    fontSize: 11.5,
    color: 'var(--shell-text-muted)',
    verticalAlign: 'top' as const,
    fontFamily: T.fMono,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  deletedBadge: {
    display: 'inline-block',
    marginLeft: 6,
    fontSize: 10,
    color: 'var(--shell-danger)',
    fontFamily: T.fMono,
  } as React.CSSProperties,
  highlight: {
    background: 'var(--shell-brand-soft)',
    color: 'var(--shell-brand-hover)',
    borderRadius: 2,
    padding: '0 2px',
  } as React.CSSProperties,
};

/** Highlight first occurrence of `query` in `text`. */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span style={S.highlight}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

/** Format epoch ms as relative string, e.g. "2h ago" or "3d ago". */
function relativeTime(ms: number | null): string {
  if (!ms) return '—';
  const diffS = Math.floor((Date.now() - ms) / 1000);
  if (diffS < 120) return 'just now';
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
}

interface SearchResultsSessionsProps {
  results: DebugSession[];
  query: string;
  isLoading: boolean;
  error: string | null;
}

export function SearchResultsSessions({
  results,
  query,
  isLoading,
  error,
}: SearchResultsSessionsProps) {
  const history = useHistory();

  if (error) return <div style={S.errorBanner}>Error: {error}</div>;

  if (isLoading && results.length === 0) {
    return (
      <div style={S.root}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={S.skeleton} />
        ))}
      </div>
    );
  }

  if (!isLoading && results.length === 0) {
    return (
      <div style={S.emptyState}>
        No sessions matched &ldquo;{query}&rdquo;. Sessions mode searches titles only.
      </div>
    );
  }

  return (
    <div style={S.root}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>title</th>
            <th style={S.th}>turns</th>
            <th style={S.th}>created</th>
            <th style={S.th}>last turn</th>
          </tr>
        </thead>
        <tbody>
          {results.map((session) => {
            const title = session.title ?? `Untitled · ${session.id.slice(0, 8)}`;
            const createdStr = new Date(session.created_at).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            });
            return (
              <tr
                key={session.id}
                style={{ cursor: 'pointer' }}
                onClick={() => history.push(`/dev/chat-audit/sessions/${session.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') history.push(`/dev/chat-audit/sessions/${session.id}`);
                }}
                role="button"
                tabIndex={0}
              >
                <td style={S.td}>
                  <Highlighted text={title} query={query} />
                  {session.deletedAt != null && (
                    <span style={S.deletedBadge}>deleted</span>
                  )}
                </td>
                <td style={S.tdMono}>{session.turn_count}</td>
                <td style={S.tdMono}>{createdStr}</td>
                <td style={S.tdMono}>{relativeTime(session.last_turn_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
