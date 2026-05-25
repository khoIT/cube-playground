/**
 * SearchResultList — flat list of cross-turn search hits.
 *
 * Renders below the search bar when query is non-empty.
 * Highlights the query term inside the snippet.
 * Click → navigate to /dev/chat-audit/:sessionId#turn-:turnId.
 */

import React from 'react';
import { T } from '../../shell/theme';
import type { SearchHit } from './use-debug-api-types';

const S = {
  root: { flex: 1, overflowY: 'auto' as const } as React.CSSProperties,
  emptyState: {
    padding: '32px 20px', textAlign: 'center' as const,
    color: T.n400, fontSize: 12,
  } as React.CSSProperties,
  row: (active: boolean): React.CSSProperties => ({
    padding: '10px 14px',
    borderBottom: `1px solid ${T.n100}`,
    cursor: 'pointer',
    background: active ? T.brandSoft : 'transparent',
    borderLeft: active ? `3px solid ${T.brand}` : '3px solid transparent',
  }),
  header: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
  } as React.CSSProperties,
  titleText: {
    fontSize: 12, fontWeight: 600, color: T.n800,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    flex: 1,
  } as React.CSSProperties,
  roleBadge: (role: string): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
    textTransform: 'uppercase' as const, borderRadius: 3, padding: '1px 5px',
    background: role === 'assistant' ? T.brandSoft : T.surfaceSubtle,
    color: role === 'assistant' ? T.brand : T.n600,
    border: `1px solid ${role === 'assistant' ? T.brandBorder : T.n300}`,
    flexShrink: 0,
  }),
  starBadge: {
    color: T.amber500, fontSize: 12, flexShrink: 0,
  } as React.CSSProperties,
  snippet: {
    fontSize: 11, color: T.n600, fontFamily: 'inherit',
    lineHeight: 1.5, wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  highlight: {
    background: T.amberSoft, color: T.n900, borderRadius: 2,
    padding: '0 1px',
  } as React.CSSProperties,
  sourceBadge: {
    fontSize: 10, color: T.n400, fontFamily: 'monospace', flexShrink: 0,
  } as React.CSSProperties,
  loadMoreBtn: {
    display: 'block', width: '100%', padding: '10px',
    textAlign: 'center' as const, fontSize: 12, color: T.brand,
    background: 'none', border: 'none', cursor: 'pointer',
    borderTop: `1px solid ${T.n100}`,
  } as React.CSSProperties,
  errorBanner: {
    margin: '8px 12px', padding: '6px 10px',
    background: T.redSoft, border: `1px solid ${T.red500}`,
    borderRadius: 5, fontSize: 11, color: T.red600,
  } as React.CSSProperties,
  skeleton: {
    height: 64, margin: '2px 12px', borderRadius: 4,
    background: T.n100,
  } as React.CSSProperties,
};

/** Highlight first occurrence of `query` in `text` with a <mark>-like span. */
function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  if (!query) return <span style={S.snippet}>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span style={S.snippet}>{text}</span>;

  return (
    <span style={S.snippet}>
      {text.slice(0, idx)}
      <span style={S.highlight}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </span>
  );
}

interface SearchResultListProps {
  results: SearchHit[];
  query: string;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedSessionId: string | null;
  onSelect: (sessionId: string, turnId: string) => void;
}

export function SearchResultList({
  results,
  query,
  isLoading,
  error,
  hasMore,
  onLoadMore,
  selectedSessionId,
  onSelect,
}: SearchResultListProps) {
  return (
    <div style={S.root}>
      {error && <div style={S.errorBanner}>Error: {error}</div>}

      {isLoading && results.length === 0 && (
        Array.from({ length: 4 }).map((_, i) => <div key={i} style={S.skeleton} />)
      )}

      {!isLoading && results.length === 0 && !error && (
        <div style={S.emptyState}>
          No turns matched &ldquo;{query}&rdquo;.
        </div>
      )}

      {results.map((hit) => (
        <div
          key={hit.turnId}
          style={S.row(hit.sessionId === selectedSessionId)}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(hit.sessionId, hit.turnId)}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(hit.sessionId, hit.turnId)}
        >
          <div style={S.header}>
            <div style={S.titleText}>
              {hit.sessionTitle ?? `Session ${hit.sessionId.slice(0, 8)}`}
            </div>
            <span style={S.roleBadge(hit.role)}>{hit.role}</span>
            {hit.starred && <span style={S.starBadge}>★</span>}
            <span style={S.sourceBadge}>{hit.matchSource}</span>
          </div>
          <HighlightedSnippet text={hit.snippet} query={query} />
        </div>
      ))}

      {hasMore && (
        <button style={S.loadMoreBtn} onClick={onLoadMore} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Load more results'}
        </button>
      )}
    </div>
  );
}
