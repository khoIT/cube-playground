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
import { Switch, Route, Redirect, useHistory, useLocation, useRouteMatch } from 'react-router-dom';
import type { TabDef } from '../../shell/tab-shell';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { AuditTabs } from './audit-tabs';
import { AuditBasePathProvider } from './audit-base-path';
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
    background: 'var(--surface-raised)',
    overflow: 'hidden',
  } as React.CSSProperties,

  /** Sticky header: banner + tab bar stay pinned at top during scroll. */
  stickyHeader: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    flexShrink: 0,
    background: 'var(--surface-raised)',
    borderBottom: `1px solid var(--shell-border)`,
  } as React.CSSProperties,

  banner: {
    padding: '6px 16px',
    background: 'var(--surface-subtle)',
    borderBottom: `1px solid var(--shell-border)`,
    fontSize: 11,
    color: 'var(--shell-text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  } as React.CSSProperties,

  gameBadge: {
    marginLeft: 'auto',
    color: 'var(--shell-text-subtle)',
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
function LegacySessionRedirect({ basePath }: { basePath: string }) {
  const match = useRouteMatch<{ sessionId: string }>(`${basePath}/:sessionId`);
  const location = useLocation();
  if (!match) return <Redirect to={`${basePath}/sessions`} />;
  // Preserve hash fragment so anchored bookmarks (e.g. #turn-xyz) survive the redirect.
  return (
    <Redirect
      to={{ pathname: `${basePath}/sessions/${match.params.sessionId}`, hash: location.hash }}
    />
  );
}

interface DevAuditShellProps {
  /** Mount path — standalone /dev/chat-audit or /admin/dev/chat-audit. */
  basePath?: string;
  /** Explicit tab set; defaults to the full set (incl. Starters) for standalone. */
  tabs?: TabDef[];
  /**
   * Owner→display resolver for the Sessions tab owner filter. Admin context
   * supplies one that maps Keycloak sub → email; standalone omits it (keeps
   * `label || ownerId`). Kept as a prop so DevAudit/ takes no Admin/ import.
   */
  resolveOwner?: (o: { ownerId: string; label: string | null }) => string;
}

export function DevAuditShell({ basePath = '/dev/chat-audit', tabs, resolveOwner }: DevAuditShellProps) {
  const gameId = useActiveGameId();
  const history = useHistory();
  // Standalone mount shows the framing banner; the admin hub already frames the
  // surface with its own page header + tab row, so suppress the duplicate banner.
  const isStandalone = basePath === '/dev/chat-audit';

  /**
   * searchInputRef: forwarded to SearchTab's input so cmd-K can focus it.
   * We navigate to /search first, then dispatch a focus-search custom event.
   * SearchTab listens on mount and when this event fires.
   */
  const handleCmdK = useCallback(() => {
    // Navigate to search tab if not already there
    const onSearch = history.location.pathname.startsWith(`${basePath}/search`);
    if (!onSearch) {
      history.push(`${basePath}/search`);
    }
    // Dispatch a custom event that SearchTab listens to for focusing its input.
    // Using a custom event decouples shell from SearchTab's internal ref.
    window.dispatchEvent(new CustomEvent('dev-audit:focus-search'));
  }, [history, basePath]);

  useDevAuditShortcuts({ onCmdK: handleCmdK, basePath });

  return (
    <AuditBasePathProvider value={basePath}>
      <div style={S.root}>
        {/* Sticky header: banner + tabs pinned on scroll */}
        <div style={S.stickyHeader}>
          {/* Shared banner — standalone only (admin hub frames its own header) */}
          {isStandalone && (
            <div style={S.banner}>
              <span>Chat Audit — internal triage tool</span>
              <span style={S.gameBadge}>game: {gameId}</span>
            </div>
          )}

          {/* Tab navigation */}
          <AuditTabs basePath={basePath} tabs={tabs} />
        </div>

        {/* Tab content area */}
        <div style={S.content}>
          <Switch>
            {/* Exact base → redirect to sessions tab */}
            <Route exact path={basePath}>
              <Redirect to={`${basePath}/sessions`} />
            </Route>

            {/* Sessions tab: {base}/sessions/:sessionId? */}
            <Route path={`${basePath}/sessions/:sessionId?`}>
              <div role="tabpanel" id="audit-panel-sessions" aria-labelledby="audit-tab-sessions" style={{ display: 'contents' }}>
                <SessionsTab resolveOwner={resolveOwner} />
              </div>
            </Route>

            {/* Search tab: {base}/search */}
            <Route path={`${basePath}/search`}>
              <div role="tabpanel" id="audit-panel-search" aria-labelledby="audit-tab-search" style={{ display: 'contents' }}>
                <SearchTab />
              </div>
            </Route>

            {/* Leaderboard tab: {base}/leaderboard */}
            <Route path={`${basePath}/leaderboard`}>
              <div role="tabpanel" id="audit-panel-leaderboard" aria-labelledby="audit-tab-leaderboard" style={{ display: 'contents' }}>
                <SkillLeaderboardPage />
              </div>
            </Route>

            {/* Cache tab: {base}/cache */}
            <Route path={`${basePath}/cache`}>
              <div role="tabpanel" id="audit-panel-cache" aria-labelledby="audit-tab-cache" style={{ display: 'contents' }}>
                <CacheTab />
              </div>
            </Route>

            {/* Legacy redirect: {base}/:sessionId → {base}/sessions/:sessionId */}
            <Route path={`${basePath}/:sessionId`}>
              <LegacySessionRedirect basePath={basePath} />
            </Route>
          </Switch>
        </div>
      </div>
    </AuditBasePathProvider>
  );
}
