/**
 * AuditTabs — horizontal top-tab bar for the chat-audit shell.
 * 4 tabs: Sessions / Search / Leaderboard / Cache.
 *
 * Active tab derived from current URL pathname (no extra state).
 * Keyboard: ArrowLeft / ArrowRight cycles tabs (WAI-ARIA tabs pattern,
 * horizontal orientation). Matches hi-fi mockup styling.
 */
import React, { useRef } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { T } from '../../shell/theme';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabKey = 'sessions' | 'search' | 'leaderboard' | 'cache';

const TAB_ORDER: TabKey[] = ['sessions', 'search', 'leaderboard', 'cache'];

const TAB_LABELS: Record<TabKey, string> = {
  sessions:    'Sessions',
  search:      'Search',
  leaderboard: 'Leaderboard',
  cache:       'Cache',
};

const TAB_PATHS: Record<TabKey, string> = {
  sessions:    '/dev/chat-audit/sessions',
  search:      '/dev/chat-audit/search',
  leaderboard: '/dev/chat-audit/leaderboard',
  cache:       '/dev/chat-audit/cache',
};

/** Resolve which tab is active based on pathname. */
export function resolveAuditTab(pathname: string): TabKey {
  if (pathname.startsWith('/dev/chat-audit/search'))      return 'search';
  if (pathname.startsWith('/dev/chat-audit/leaderboard')) return 'leaderboard';
  if (pathname.startsWith('/dev/chat-audit/cache'))       return 'cache';
  return 'sessions'; // default — covers /sessions/* and legacy bare IDs
}

// ---------------------------------------------------------------------------
// Styles (inline — T.* tokens only)
// ---------------------------------------------------------------------------

const S = {
  tabbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    padding: '0 16px',
    background: T.surface,
    borderBottom: `1px solid ${T.n200}`,
    flexShrink: 0,
  } as React.CSSProperties,

  tab: (active: boolean): React.CSSProperties => ({
    fontSize: 12,
    padding: '8px 14px',
    color: active ? T.n900 : T.n600,
    textDecoration: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    fontFamily: T.fSans,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    border: 'none',
    borderBottomStyle: 'solid',
    borderBottomWidth: 2,
    borderBottomColor: active ? T.brand : 'transparent',
    outline: 'none',
    transition: 'color 120ms ease, border-bottom-color 120ms ease',
  }),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AuditTabsProps {
  /** Optional testid prefix (default 'audit-tab'). */
  testIdPrefix?: string;
}

export function AuditTabs({ testIdPrefix = 'audit-tab' }: AuditTabsProps) {
  const history = useHistory();
  const location = useLocation();
  const activeKey = resolveAuditTab(location.pathname);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function go(key: TabKey) {
    const target = TAB_PATHS[key];
    // Don't push duplicate history entry
    if (!location.pathname.startsWith(TAB_PATHS[key])) {
      history.push(target);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' &&
        e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    let next = index;
    if (e.key === 'ArrowLeft')  next = (index - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    else if (e.key === 'ArrowRight') next = (index + 1) % TAB_ORDER.length;
    else if (e.key === 'Home')  next = 0;
    else if (e.key === 'End')   next = TAB_ORDER.length - 1;
    refs.current[next]?.focus();
    go(TAB_ORDER[next]);
  }

  return (
    <div role="tablist" aria-label="Chat Audit" aria-orientation="horizontal" style={S.tabbar}>
      {TAB_ORDER.map((key, i) => {
        const active = activeKey === key;
        return (
          <button
            key={key}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`audit-tab-${key}`}
            aria-selected={active}
            aria-controls={`audit-panel-${key}`}
            tabIndex={active ? 0 : -1}
            data-testid={`${testIdPrefix}-${key}`}
            style={S.tab(active)}
            onClick={() => go(key)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            onMouseEnter={(e) => {
              if (!active) {
                (e.currentTarget as HTMLButtonElement).style.color = T.n800;
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                (e.currentTarget as HTMLButtonElement).style.color = T.n600;
              }
            }}
          >
            {TAB_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
