/**
 * DevAuditShell — top-level layout for /dev/chat-audit/*.
 *
 * Owns:
 *   - Top banner (game badge, owner note) — shared across all tabs
 *   - AuditTabs bar (Sessions / Search / Leaderboard / Cache)
 *   - <Switch> that renders the active tab content
 *
 * Legacy redirect: /dev/chat-audit/:sessionId → /dev/chat-audit/sessions/:sessionId
 * Default redirect: /dev/chat-audit (exact) → /dev/chat-audit/sessions
 *
 * Shell does NOT remount on tab change — only the inner Switch content swaps.
 */
import React, { useCallback, useRef } from 'react';
import { Switch, Route, Redirect, useHistory, useRouteMatch, useLocation } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { AuditTabs } from './audit-tabs';
import { SessionsTab } from './sessions-tab';
import { SearchTab } from './search-tab';
import { CacheTab } from './cache-tab';
import { SkillLeaderboardPage } from './skill-leaderboard-page';
import { useDevAuditShortcuts } from './use-dev-audit-shortcuts';

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    fontFamily: T.fSans,
    background: T.surface,
    overflow: 'hidden',
  } as React.CSSProperties,

  /** Sticky header: banner + tab bar stay pinned at top during scroll. */
  stickyHeader: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    flexShrink: 0,
    background: T.surface,
    borderBottom: `1px solid ${T.n200}`,
  } as React.CSSProperties,

  banner: {
    padding: '6px 16px',
    background: T.surfaceSubtle,
    borderBottom: `1px solid ${T.n200}`,
    fontSize: 11,
    color: T.n600,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  } as React.CSSProperties,

  gameBadge: {
    marginLeft: 'auto',
    color: T.n500,
    fontFamily: T.fMono,
  } as React.CSSProperties,

  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minHeight: 0,
  } as React.CSSProperties,
};

/**
 * LegacySessionRedirect: handles /dev/chat-audit/:sessionId (no /sessions/ segment).
 * Redirects to /dev/chat-audit/sessions/:sessionId preserving the ID.
 *
 * Must be placed AFTER the specific sub-routes in the Switch so that
 * /dev/chat-audit/search, /leaderboard, /cache are matched first.
 */
function LegacySessionRedirect() {
  const match = useRouteMatch<{ sessionId: string }>('/dev/chat-audit/:sessionId');
  const location = useLocation();
  if (!match) return <Redirect to="/dev/chat-audit/sessions" />;
  // Preserve hash so anchored bookmarks like /dev/chat-audit/abc#turn-xyz keep the anchor
  return (
    <Redirect
      to={{ pathname: `/dev/chat-audit/sessions/${match.params.sessionId}`, hash: location.hash }}
    />
  );
}

export function DevAuditShell() {
  const gameId = useActiveGameId();
  const history = useHistory();

  /**
   * searchInputRef: forwarded to SearchTab's input so cmd-K can focus it.
   * We navigate to /search first, then dispatch a focus-search custom event.
   * SearchTab listens on mount and when this event fires.
   */
  const handleCmdK = useCallback(() => {
    // Navigate to search tab if not already there
    const onSearch = history.location.pathname.startsWith('/dev/chat-audit/search');
    if (!onSearch) {
      history.push('/dev/chat-audit/search');
    }
    // Dispatch a custom event that SearchTab listens to for focusing its input.
    // Using a custom event decouples shell from SearchTab's internal ref.
    window.dispatchEvent(new CustomEvent('dev-audit:focus-search'));
  }, [history]);

  useDevAuditShortcuts({ onCmdK: handleCmdK });

  return (
    <div style={S.root}>
      {/* Sticky header: banner + tabs pinned on scroll */}
      <div style={S.stickyHeader}>
        {/* Shared banner — stable across tab switches */}
        <div style={S.banner}>
          <span>Chat Audit — internal triage tool</span>
          <span style={S.gameBadge}>game: {gameId}</span>
        </div>

        {/* Tab navigation */}
        <AuditTabs />
      </div>

      {/* Tab content area */}
      <div style={S.content}>
        <Switch>
          {/* Exact base → redirect to sessions tab */}
          <Route exact path="/dev/chat-audit">
            <Redirect to="/dev/chat-audit/sessions" />
          </Route>

          {/* Sessions tab: /dev/chat-audit/sessions/:sessionId? */}
          <Route path="/dev/chat-audit/sessions/:sessionId?">
            <div role="tabpanel" id="audit-panel-sessions" aria-labelledby="audit-tab-sessions" style={{ display: 'contents' }}>
              <SessionsTab />
            </div>
          </Route>

          {/* Search tab: /dev/chat-audit/search */}
          <Route path="/dev/chat-audit/search">
            <div role="tabpanel" id="audit-panel-search" aria-labelledby="audit-tab-search" style={{ display: 'contents' }}>
              <SearchTab />
            </div>
          </Route>

          {/* Leaderboard tab: /dev/chat-audit/leaderboard */}
          <Route path="/dev/chat-audit/leaderboard">
            <div role="tabpanel" id="audit-panel-leaderboard" aria-labelledby="audit-tab-leaderboard" style={{ display: 'contents' }}>
              <SkillLeaderboardPage />
            </div>
          </Route>

          {/* Cache tab: /dev/chat-audit/cache */}
          <Route path="/dev/chat-audit/cache">
            <div role="tabpanel" id="audit-panel-cache" aria-labelledby="audit-tab-cache" style={{ display: 'contents' }}>
              <CacheTab />
            </div>
          </Route>

          {/* Legacy redirect: /dev/chat-audit/:sessionId → /dev/chat-audit/sessions/:sessionId */}
          <Route path="/dev/chat-audit/:sessionId">
            <LegacySessionRedirect />
          </Route>
        </Switch>
      </div>
    </div>
  );
}
