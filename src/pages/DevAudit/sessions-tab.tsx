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
import { useDebugSessionOwners } from './use-debug-api';

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
    background: 'var(--surface-subtle)',
    borderBottom: `1px solid var(--shell-border)`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    color: 'var(--shell-text-muted)',
  } as React.CSSProperties,

  searchInput: {
    flex: 1,
    maxWidth: 320,
    padding: '3px 10px',
    border: `1px solid var(--shell-border-strong)`,
    borderRadius: 6,
    fontSize: 12,
    fontFamily: T.fSans,
    outline: 'none',
    background: 'var(--surface-raised)',
    color: 'var(--shell-text-emphasis)',
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
    borderRight: `1px solid var(--shell-border)`,
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

  // Admin user filter — pin the audit to one owner_id ('' = all owners).
  const [ownerFilter, setOwnerFilter] = useState('');
  const ownersEnabled = isAdmin && effectiveScope === 'all';
  const { data: owners } = useDebugSessionOwners({ game: gameId, enabled: ownersEnabled });

  // Clear the user pin whenever it can't apply (left admin scope, or the
  // active game changed and the previously-picked owner may not exist here).
  useEffect(() => {
    if (!ownersEnabled) setOwnerFilter('');
  }, [ownersEnabled]);
  useEffect(() => {
    setOwnerFilter('');
  }, [gameId]);

  // Exact counts from the owners endpoint (independent of the list's row cap).
  const totalCount = (owners ?? []).reduce((sum, o) => sum + o.count, 0);
  const selectedCount = ownerFilter
    ? (owners ?? []).find((o) => o.ownerId === ownerFilter)?.count ?? 0
    : totalCount;

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
                  border: `1px solid ${scope === s ? 'var(--shell-brand)' : 'var(--shell-border-strong)'}`,
                  borderRadius: 5,
                  background: scope === s ? 'var(--shell-brand-soft)' : 'var(--surface-raised)',
                  color: scope === s ? 'var(--shell-brand)' : 'var(--shell-text-muted)',
                  fontWeight: scope === s ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {s === 'all' ? 'All users' : 'Mine'}
              </button>
            ))}
          </div>
        )}
        {ownersEnabled && (
          <select
            aria-label="Filter by user"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            data-testid="session-owner-filter"
            style={{
              fontSize: 11,
              fontFamily: T.fSans,
              padding: '2px 6px',
              maxWidth: 220,
              border: `1px solid ${ownerFilter ? 'var(--shell-brand)' : 'var(--shell-border-strong)'}`,
              borderRadius: 5,
              background: 'var(--surface-raised)',
              color: ownerFilter ? 'var(--shell-brand)' : 'var(--shell-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <option value="">All users ({totalCount})</option>
            {(owners ?? []).map((o) => (
              <option key={o.ownerId} value={o.ownerId}>
                {(o.label || o.ownerId)} ({o.count})
              </option>
            ))}
          </select>
        )}
        {ownersEnabled && (
          <span data-testid="session-count" style={{ color: 'var(--shell-text-subtle)', whiteSpace: 'nowrap' }}>
            {selectedCount} session{selectedCount === 1 ? '' : 's'}
          </span>
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
              owner={ownerFilter}
            />
          )}
        </div>

        <SessionDetail sessionId={selectedSessionId} />
      </div>
    </div>
  );
}
