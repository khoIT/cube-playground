/**
 * SessionsTab — two-pane view (session list + session detail).
 * Extracted from the original DevAuditPage body.
 * Route: /dev/chat-audit/sessions/:sessionId?
 *
 * URL shape: selecting a session replaces history to
 * /dev/chat-audit/sessions/:id (keeps Sessions tab active).
 */
import React, { useState, useEffect, useRef } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useAuthUser } from '../../auth/auth-context';
import { SessionList } from './session-list';
import { SessionDetail } from './session-detail';
import { SearchResultList } from './search-result-list';
import { useDebugSearch } from './use-debug-search';

const S = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minHeight: 0,
  } as React.CSSProperties,

  searchBar: {
    flexShrink: 0,
    padding: '6px 16px',
    background: T.surfaceSubtle,
    borderBottom: `1px solid ${T.n200}`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    color: T.n600,
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

export function SessionsTab() {
  const gameId = useActiveGameId();
  const history = useHistory();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const selectedSessionId = routeSessionId ?? null;

  // Admins audit ALL users' sessions by default; non-admins are always
  // self-scoped (the server enforces the role on scope=all regardless).
  const isAdmin = useAuthUser()?.role === 'admin';
  const [scope, setScope] = useState<'mine' | 'all'>('all');
  const effectiveScope: 'mine' | 'all' = isAdmin ? scope : 'mine';

  // Cross-turn search — debounced 300 ms (preserved from original DevAuditPage)
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
    history.replace(id ? `/dev/chat-audit/sessions/${id}` : '/dev/chat-audit/sessions');
  }

  function handleSearchSelect(sessionId: string, turnId: string): void {
    history.push(`/dev/chat-audit/sessions/${sessionId}#turn-${turnId}`);
  }

  return (
    <div style={S.root}>
      {/* Inline search bar preserved from original banner */}
      <div style={S.searchBar}>
        <span>
          {effectiveScope === 'all'
            ? 'Showing all users’ chat sessions for triage.'
            : 'Showing your own chat sessions for triage.'}
        </span>
        {isAdmin && (
          <div role="radiogroup" aria-label="Session scope" style={{ display: 'flex', gap: 2 }}>
            {(['all', 'mine'] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={scope === s}
                onClick={() => setScope(s)}
                data-testid={`session-scope-${s}`}
                style={{
                  fontSize: 11,
                  padding: '2px 10px',
                  border: `1px solid ${scope === s ? T.brand : T.n300}`,
                  borderRadius: 5,
                  background: scope === s ? T.brandSoft : T.surface,
                  color: scope === s ? T.brand : T.n600,
                  fontWeight: scope === s ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {s === 'all' ? 'All users' : 'Mine'}
              </button>
            ))}
          </div>
        )}
        <input
          type="search"
          placeholder="Search all turns…"
          value={rawQ}
          onChange={(e) => setRawQ(e.target.value)}
          style={S.searchInput}
          aria-label="Search turns"
          data-testid="turn-search-input"
        />
      </div>

      <div style={S.body}>
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
              scope={effectiveScope}
            />
          )}
        </div>

        <SessionDetail sessionId={selectedSessionId} />
      </div>
    </div>
  );
}
