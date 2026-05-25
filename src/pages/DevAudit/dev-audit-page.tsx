/**
 * DevAuditPage — route component for /dev/chat-audit.
 * Internal triage tool: session list (left) + session/turn detail (right).
 * Data is always scoped to the current owner via X-Owner-Id header.
 *
 * Phase-04: adds a cross-turn search bar in the top banner.
 * When query is non-empty the left pane swaps SessionList → SearchResultList.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useHistory, useParams, Link } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { SessionList } from './session-list';
import { SessionDetail } from './session-detail';
import { SearchResultList } from './search-result-list';
import { useDebugSearch } from './use-debug-search';

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
    gap: 8,
  } as React.CSSProperties,
  searchInput: {
    flex: 1,
    maxWidth: 320,
    padding: '3px 10px',
    border: `1px solid ${T.n300}`,
    borderRadius: 6,
    fontSize: 12,
    fontFamily: T.fSans,
    outline: 'none',
    background: T.surface,
    color: T.n800,
  } as React.CSSProperties,
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'row' as const,
    overflow: 'hidden',
    minHeight: 0,
  } as React.CSSProperties,
  leftPane: {
    width: 340,
    minWidth: 280,
    display: 'flex',
    flexDirection: 'column' as const,
    borderRight: `1px solid ${T.n200}`,
    height: '100%',
    overflow: 'hidden',
  } as React.CSSProperties,
};

export function DevAuditPage() {
  const gameId = useActiveGameId();
  const history = useHistory();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const selectedSessionId = routeSessionId ?? null;

  // Cross-turn search — debounced 300ms
  const [rawQ, setRawQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQ(rawQ), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [rawQ]);

  const searchActive = debouncedQ.trim().length > 0;
  const { results, isLoading: searchLoading, error: searchError, hasMore, loadMore } =
    useDebugSearch(debouncedQ, { game: gameId });

  function setSelectedSessionId(id: string | null): void {
    history.replace(id ? `/dev/chat-audit/${id}` : '/dev/chat-audit');
  }

  function handleSearchSelect(sessionId: string, turnId: string): void {
    // Navigate to session and scroll to the turn anchor
    history.push(`/dev/chat-audit/${sessionId}#turn-${turnId}`);
  }

  return (
    <div style={S.root}>
      <div style={S.banner}>
        <span>Showing your own chat sessions for triage.</span>
        {/* Phase-05: leaderboard nav link */}
        <Link
          to="/dev/chat-audit/leaderboard"
          style={{ color: T.brand, textDecoration: 'none', fontWeight: 500, fontSize: 12 }}
        >
          Leaderboard
        </Link>
        {/* Phase-04: cross-turn search */}
        <input
          type="search"
          placeholder="Search all turns…"
          value={rawQ}
          onChange={(e) => setRawQ(e.target.value)}
          style={S.searchInput}
          aria-label="Search turns"
          data-testid="turn-search-input"
        />
        <span style={{ marginLeft: 'auto', color: T.n500, fontFamily: T.fMono }}>
          game: {gameId}
        </span>
      </div>

      <div style={S.body}>
        {/* Left pane: search results OR session list */}
        <div style={S.leftPane}>
          {searchActive ? (
            <SearchResultList
              results={results}
              query={debouncedQ}
              isLoading={searchLoading}
              error={searchError}
              hasMore={hasMore}
              onLoadMore={loadMore}
              selectedSessionId={selectedSessionId}
              onSelect={handleSearchSelect}
            />
          ) : (
            <SessionList
              gameId={gameId}
              selectedId={selectedSessionId}
              onSelect={setSelectedSessionId}
            />
          )}
        </div>

        <SessionDetail sessionId={selectedSessionId} />
      </div>
    </div>
  );
}
