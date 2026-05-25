/**
 * SearchResultsCached — renders cached-query search hits for the Search tab Cached mode.
 *
 * Each row: query snippet (with highlight), skill, model, hit count, $ cost saved.
 * Click → navigates to the original session that seeded the cache entry.
 *
 * Data source: GET /api/chat/debug/search/cached?q=&game=
 */

import React from 'react';
import { useHistory } from 'react-router-dom';
import { T } from '../../shell/theme';
import type { CachedQueryHit } from './use-debug-api-types';

const S = {
  root: { flex: 1, overflowY: 'auto' as const } as React.CSSProperties,
  emptyState: {
    padding: '32px 20px',
    textAlign: 'center' as const,
    color: T.n400,
    fontSize: 12,
  } as React.CSSProperties,
  skeleton: {
    height: 56,
    margin: '2px 12px',
    borderRadius: 4,
    background: T.n100,
    marginBottom: 2,
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
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    fontSize: 10.5,
    color: T.n500,
    fontWeight: 500,
    padding: '6px 8px',
    borderBottom: `1px solid ${T.n200}`,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    fontFamily: T.fMono,
  } as React.CSSProperties,
  thRight: {
    textAlign: 'right' as const,
    fontSize: 10.5,
    color: T.n500,
    fontWeight: 500,
    padding: '6px 8px',
    borderBottom: `1px solid ${T.n200}`,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    fontFamily: T.fMono,
  } as React.CSSProperties,
  td: {
    padding: '8px',
    borderBottom: `1px solid ${T.n100}`,
    fontSize: 12,
    color: T.n800,
    verticalAlign: 'top' as const,
  } as React.CSSProperties,
  tdMono: {
    padding: '8px',
    borderBottom: `1px solid ${T.n100}`,
    fontSize: 11.5,
    color: T.n600,
    verticalAlign: 'top' as const,
    fontFamily: T.fMono,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  tdMonoRight: {
    padding: '8px',
    borderBottom: `1px solid ${T.n100}`,
    fontSize: 11.5,
    color: T.n600,
    verticalAlign: 'top' as const,
    fontFamily: T.fMono,
    whiteSpace: 'nowrap' as const,
    textAlign: 'right' as const,
  } as React.CSSProperties,
  snippetMeta: {
    fontFamily: T.fMono,
    fontSize: 10.5,
    color: T.n500,
    marginTop: 2,
  } as React.CSSProperties,
  highlight: {
    background: T.brandSoft,
    color: T.brandHover,
    borderRadius: 2,
    padding: '0 2px',
  } as React.CSSProperties,
};

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

interface SearchResultsCachedProps {
  results: CachedQueryHit[];
  query: string;
  isLoading: boolean;
  error: string | null;
}

export function SearchResultsCached({
  results,
  query,
  isLoading,
  error,
}: SearchResultsCachedProps) {
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
        No cached queries matched &ldquo;{query}&rdquo;.
      </div>
    );
  }

  return (
    <div style={S.root}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>cached query</th>
            <th style={S.th}>skill</th>
            <th style={S.thRight}>hits</th>
            <th style={S.thRight}>$ cost/entry</th>
          </tr>
        </thead>
        <tbody>
          {results.map((hit) => (
            <tr
              key={hit.key}
              style={{ cursor: 'pointer' }}
              onClick={() =>
                history.push(`/dev/chat-audit/sessions/${hit.original_session_id}#turn-${hit.original_turn_id}`)
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  history.push(`/dev/chat-audit/sessions/${hit.original_session_id}#turn-${hit.original_turn_id}`);
              }}
              role="button"
              tabIndex={0}
            >
              <td style={S.td}>
                <div>
                  <Highlighted text={hit.user_text_snippet} query={query} />
                </div>
                <div style={S.snippetMeta}>{hit.model}</div>
              </td>
              <td style={S.tdMono}>{hit.skill}</td>
              <td style={S.tdMonoRight}>{hit.hit_count}</td>
              <td style={S.tdMonoRight}>${hit.cost_usd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
