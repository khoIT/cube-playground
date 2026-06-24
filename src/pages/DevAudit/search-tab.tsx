/**
 * SearchTab — unified cross-entity search for /dev/chat-audit/search.
 *
 * URL state: ?q=<query>&mode=turns|sessions|cached
 * - Input debounced 300ms → URL push
 * - Mode chip switch → URL push, results reload
 * - Auto-focuses input on mount
 * - Empty query → default top-10 list per mode (recent turns/sessions, top
 *   cached queries) so the tab has affordance before the user types.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { SearchModeChips } from './search-mode-chips';
import type { SearchMode } from './search-mode-chips';
import { SearchResultList } from './search-result-list';
import { SearchResultsSessions } from './search-results-sessions';
import { SearchResultsCached } from './search-results-cached';
import { useDebugSearch } from './use-debug-search';
import { useDebugSessionsSearch } from './use-debug-sessions-search';
import { useDebugCachedQueriesSearch } from './use-debug-cached-queries-search';
import { useAuditBasePath, auditPath } from './audit-base-path';

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const VALID_MODES: SearchMode[] = ['turns', 'sessions', 'cached'];

function parseUrlState(search: string): { q: string; mode: SearchMode } {
  const p = new URLSearchParams(search);
  const rawMode = p.get('mode') ?? 'turns';
  const mode: SearchMode = (VALID_MODES as string[]).includes(rawMode)
    ? (rawMode as SearchMode)
    : 'turns';
  return { q: p.get('q') ?? '', mode };
}

// ---------------------------------------------------------------------------
// Placeholder text per mode
// ---------------------------------------------------------------------------

const isMac = typeof navigator !== 'undefined'
  ? navigator.platform.toUpperCase().includes('MAC')
  : false;
const CMD_HINT = isMac ? ' (⌘K)' : ' (Ctrl+K)';

const PLACEHOLDERS: Record<SearchMode, string> = {
  turns:    `Search turn text…${CMD_HINT}`,
  sessions: `Search session titles…${CMD_HINT}`,
  cached:   `Search cached queries…${CMD_HINT}`,
};

// Label shown above the default (empty-query) top-10 list per mode.
const DEFAULT_LIST_LABELS: Record<SearchMode, string> = {
  turns:    'Recent turns',
  sessions: 'Recent sessions',
  cached:   'Top cached queries',
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minHeight: 0,
  } as React.CSSProperties,

  inputWrap: {
    flexShrink: 0,
    padding: '12px 16px 8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    borderBottom: `1px solid var(--shell-border)`,
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '8px 12px',
    border: `1px solid var(--shell-border-strong)`,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: T.fSans,
    background: 'var(--surface-raised)',
    color: 'var(--shell-text-emphasis)',
    outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  defaultLabelBar: {
    flexShrink: 0,
    padding: '6px 16px',
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    borderBottom: `1px solid var(--shell-border)`,
    background: 'var(--surface-subtle)',
  } as React.CSSProperties,

  defaultLabel: {
    fontFamily: T.fMono,
    fontSize: 10.5,
    color: 'var(--shell-text-subtle)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  } as React.CSSProperties,

  defaultHint: {
    fontSize: 11,
    color: 'var(--shell-text-faint)',
  } as React.CSSProperties,

  results: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  } as React.CSSProperties,
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SearchTab() {
  const history = useHistory();
  const location = useLocation();
  const gameId = useActiveGameId();
  const basePath = useAuditBasePath();

  const { q: urlQ, mode: urlMode } = parseUrlState(location.search);

  // Local controlled input — debounced 300ms → URL
  const [rawInput, setRawInput] = useState(urlQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input when URL changes externally (e.g. browser back)
  useEffect(() => {
    setRawInput(urlQ);
  }, [urlQ]);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Listen for the shell's cmd-K focus-search event
  useEffect(() => {
    function handleFocusSearch() {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener('dev-audit:focus-search', handleFocusSearch);
    return () => window.removeEventListener('dev-audit:focus-search', handleFocusSearch);
  }, []);

  function pushUrl(q: string, mode: SearchMode) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    p.set('mode', mode);
    history.push({ pathname: location.pathname, search: `?${p.toString()}` });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setRawInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushUrl(val, urlMode);
    }, 300);
  }

  function handleModeChange(mode: SearchMode) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushUrl(rawInput, mode);
  }

  // Turns mode search — recentOnEmpty so an empty query shows recent turns.
  const turnsSearch = useDebugSearch(urlQ, { game: gameId ?? undefined, recentOnEmpty: true });
  // Sessions mode search
  const sessionsSearch = useDebugSessionsSearch(urlQ, gameId ?? undefined);
  // Cached queries mode search
  const cachedSearch = useDebugCachedQueriesSearch(urlQ, gameId ?? undefined);

  function handleTurnSelect(sessionId: string, turnId: string) {
    history.push(`${auditPath(basePath, 'sessions', sessionId)}#turn-${turnId}`);
  }

  const isEmpty = !urlQ.trim();

  return (
    <div style={S.root}>
      {/* Input + mode chips */}
      <div style={S.inputWrap}>
        <input
          ref={inputRef}
          type="search"
          aria-label="Search"
          placeholder={PLACEHOLDERS[urlMode]}
          value={rawInput}
          onChange={handleInputChange}
          style={S.input}
          data-testid="unified-search-input"
          onFocus={(e) => {
            // Highlight brand border on focus — inline style toggle
            e.currentTarget.style.borderColor = 'var(--shell-brand)';
            e.currentTarget.style.boxShadow = `0 0 0 2px var(--shell-brand-border)`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--shell-border-strong)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        <SearchModeChips mode={urlMode} onChange={handleModeChange} />
      </div>

      {/* Default-list label (empty query only) */}
      {isEmpty && (
        <div style={S.defaultLabelBar} data-testid="search-default-label">
          <span style={S.defaultLabel}>{DEFAULT_LIST_LABELS[urlMode]}</span>
          <span style={S.defaultHint}>Top 10 · start typing to search</span>
        </div>
      )}

      {/* Results area */}
      <div style={S.results}>
        {urlMode === 'turns' ? (
          <SearchResultList
            results={turnsSearch.results}
            query={urlQ}
            isLoading={turnsSearch.isLoading}
            error={turnsSearch.error}
            hasMore={turnsSearch.hasMore}
            onLoadMore={turnsSearch.loadMore}
            selectedSessionId={null}
            onSelect={handleTurnSelect}
          />
        ) : urlMode === 'sessions' ? (
          <SearchResultsSessions
            results={sessionsSearch.results}
            query={urlQ}
            isLoading={sessionsSearch.isLoading}
            error={sessionsSearch.error}
          />
        ) : (
          <SearchResultsCached
            results={cachedSearch.results}
            query={urlQ}
            isLoading={cachedSearch.isLoading}
            error={cachedSearch.error}
          />
        )}
      </div>
    </div>
  );
}
