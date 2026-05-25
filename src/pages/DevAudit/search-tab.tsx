/**
 * SearchTab — unified cross-entity search for /dev/chat-audit/search.
 *
 * URL state: ?q=<query>&mode=turns|sessions|cached
 * - Input debounced 300ms → URL push
 * - Mode chip switch → URL push, results reload
 * - Auto-focuses input on mount
 * - Empty query → per-mode empty hint
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

const EMPTY_HINTS: Record<SearchMode, string> = {
  turns:    'Start typing to search turns across all your sessions.',
  sessions: 'Start typing to search session titles.',
  cached:   'Start typing to search cached queries.',
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
    borderBottom: `1px solid ${T.n200}`,
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '8px 12px',
    border: `1px solid ${T.n300}`,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: T.fSans,
    background: T.surface,
    color: T.n800,
    outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  emptyHint: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    color: T.n400,
    fontSize: 12,
    fontFamily: T.fSans,
    padding: 32,
    textAlign: 'center' as const,
  } as React.CSSProperties,

  emptyLabel: {
    fontFamily: T.fMono,
    fontSize: 10.5,
    color: T.n400,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
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

  // Turns mode search
  const turnsSearch = useDebugSearch(urlQ, { game: gameId ?? undefined });
  // Sessions mode search
  const sessionsSearch = useDebugSessionsSearch(urlQ, gameId ?? undefined);
  // Cached queries mode search
  const cachedSearch = useDebugCachedQueriesSearch(urlQ, gameId ?? undefined);

  function handleTurnSelect(sessionId: string, turnId: string) {
    history.push(`/dev/chat-audit/sessions/${sessionId}#turn-${turnId}`);
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
            e.currentTarget.style.borderColor = T.brand;
            e.currentTarget.style.boxShadow = `0 0 0 2px ${T.brandBorder}`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = T.n300;
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        <SearchModeChips mode={urlMode} onChange={handleModeChange} />
      </div>

      {/* Results area */}
      <div style={S.results}>
        {isEmpty ? (
          <div style={S.emptyHint}>
            <span style={S.emptyLabel}>{urlMode}</span>
            <span>{EMPTY_HINTS[urlMode]}</span>
          </div>
        ) : urlMode === 'turns' ? (
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
