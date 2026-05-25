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
import React from 'react';
import { Switch, Route, Redirect, useRouteMatch } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { AuditTabs } from './audit-tabs';
import { SessionsTab } from './sessions-tab';
import { SearchTab } from './search-tab';
import { CacheTab } from './cache-tab';
import { SkillLeaderboardPage } from './skill-leaderboard-page';

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
  if (!match) return <Redirect to="/dev/chat-audit/sessions" />;
  return <Redirect to={`/dev/chat-audit/sessions/${match.params.sessionId}`} />;
}

export function DevAuditShell() {
  const gameId = useActiveGameId();

  return (
    <div style={S.root}>
      {/* Shared banner — stable across tab switches */}
      <div style={S.banner}>
        <span>Chat Audit — internal triage tool</span>
        <span style={S.gameBadge}>game: {gameId}</span>
      </div>

      {/* Tab navigation */}
      <AuditTabs />

      {/* Tab content area */}
      <div style={S.content}>
        <Switch>
          {/* Exact base → redirect to sessions tab */}
          <Route exact path="/dev/chat-audit">
            <Redirect to="/dev/chat-audit/sessions" />
          </Route>

          {/* Sessions tab: /dev/chat-audit/sessions/:sessionId? */}
          <Route path="/dev/chat-audit/sessions/:sessionId?">
            <SessionsTab />
          </Route>

          {/* Search tab: /dev/chat-audit/search */}
          <Route path="/dev/chat-audit/search">
            <SearchTab />
          </Route>

          {/* Leaderboard tab: /dev/chat-audit/leaderboard */}
          <Route path="/dev/chat-audit/leaderboard">
            <SkillLeaderboardPage />
          </Route>

          {/* Cache tab: /dev/chat-audit/cache */}
          <Route path="/dev/chat-audit/cache">
            <CacheTab />
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
