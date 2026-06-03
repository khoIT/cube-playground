/**
 * TabShell — generic WAI-ARIA tablist shell, tokens.css-based.
 *
 * Extracted from the DevAudit tab bar and generalized so any feature area
 * (Sys-Admin Hub, DevAudit, future surfaces) can wire up a fully accessible
 * tablist without duplicating ARIA patterns or keyboard-nav logic.
 *
 * Design tokens used: all from src/theme/tokens.css (--text-primary,
 * --text-muted, --brand, --border-card, --bg-card, --font-sans).
 * No hermes T.* references — those belong to src/shell/theme.tsx consumers only.
 *
 * ARIA pattern: WAI-ARIA 1.2 Tabs (horizontal, automatic activation on keyboard).
 *   role=tablist → role=tab children.
 *   aria-selected, tabIndex roving (active=0 / others=-1).
 *   Keyboard: ArrowRight / ArrowLeft / Home / End.
 *
 * Routing: react-router-dom v5 (useHistory + useLocation). Active tab derived
 * from location.pathname via resolveTab so no extra state is needed.
 */

import React, { useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TabDef {
  /** Unique key for this tab (used in IDs and aria attributes). */
  key: string;
  /** Human-readable label rendered inside the tab button. */
  label: string;
  /** The route path this tab navigates to. */
  path: string;
  /**
   * Optional short pill text shown after the label (e.g. 'beta', 'Soon',
   * 'relocated'). Matches the design system's small uppercase badge.
   */
  tag?: string;
}

export interface TabShellProps {
  /**
   * Base path of the tabbed section (e.g. '/dev/chat-audit').
   * Currently informational — resolveTab uses tab paths directly, but
   * kept in the interface for callers that need to generate paths.
   */
  basePath: string;
  tabs: TabDef[];
  /** Prefix for data-testid attributes. Each tab becomes `{testIdPrefix}-{key}`. Default: 'tab'. */
  testIdPrefix?: string;
  /** aria-label for the tablist container (screen reader context). */
  ariaLabel: string;
  /** Optional panel content rendered below the tab bar. */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// resolveTab — pure helper (unit-testable without rendering)
// ---------------------------------------------------------------------------

/**
 * Finds which tab is active by longest segment-boundary match against the current pathname.
 * Falls back to the first tab if no match is found.
 *
 * Segment-boundary rule: a tab matches when pathname === tab.path OR
 * pathname.startsWith(tab.path + '/').  This prevents '/admin/access-foo'
 * from matching the 'access' tab — the path must end on a segment boundary.
 *
 * Longest-match wins: when two tab paths both match (e.g. '/base' and
 * '/base/extra' both match '/base/extra/thing'), the longer one wins.
 */
export function resolveTab(pathname: string, tabs: TabDef[]): string {
  if (tabs.length === 0) return '';

  let bestKey = tabs[0].key;
  let bestLen = -1;

  for (const tab of tabs) {
    const exact = pathname === tab.path;
    const prefixWithSlash = pathname.startsWith(tab.path + '/');
    if ((exact || prefixWithSlash) && tab.path.length > bestLen) {
      bestKey = tab.key;
      bestLen = tab.path.length;
    }
  }

  return bestKey;
}

// ---------------------------------------------------------------------------
// Inline styles — tokens.css CSS variables only, no hermes T.*
// ---------------------------------------------------------------------------

const S = {
  tabbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    // bottom border serves as the visual separator; active tab overlaps it
    // with its own 2px brand border using marginBottom: -1 trick.
    borderBottom: '1px solid var(--border-card)',
    background: 'var(--bg-card)',
    flexShrink: 0,
  } as React.CSSProperties,

  tab: (active: boolean): React.CSSProperties => ({
    fontSize: 13,
    padding: '10px 14px',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    cursor: 'pointer',
    fontWeight: active ? 700 : 500,
    fontFamily: 'var(--font-sans)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    background: 'transparent',
    border: 'none',
    // 2px solid brand on active, transparent otherwise.
    // marginBottom: -1 makes the brand underline sit flush over the container
    // border so there's no double-line gap.
    borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
    marginBottom: -1,
    outline: 'none',
    transition: 'color 120ms ease, border-bottom-color 120ms ease',
  }),

  tag: {
    fontSize: 9.5,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    color: 'var(--text-muted)',
    background: 'var(--bg-muted)',
    border: '1px solid var(--border-card)',
    padding: '1px 6px',
    borderRadius: 'var(--radius-full)',
  } as React.CSSProperties,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TabShell({
  basePath: _basePath, // held in interface for callers, not used in render
  tabs,
  ariaLabel,
  testIdPrefix = 'tab',
  children,
}: TabShellProps) {
  const history = useHistory();
  const location = useLocation();

  // Derive active key from pathname — no useState needed; URL is source of truth.
  // We hold a local copy for keyboard-nav so pressing Arrow keys updates the
  // visual immediately (WAI-ARIA: automatic selection on focus move).
  const [activeKey, setActiveKey] = useState<string>(() =>
    resolveTab(location.pathname, tabs),
  );

  // Keep activeKey in sync with navigation (back/forward, programmatic pushes).
  // We re-derive from location.pathname on every render instead of an effect
  // so the render is always consistent with the URL.
  const derivedKey = resolveTab(location.pathname, tabs);
  // Sync only when the URL-derived key differs from our local key
  // (avoids tearing when keyboard nav pushes history then location catches up).
  const displayKey = derivedKey !== activeKey ? derivedKey : activeKey;

  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function navigate(key: string) {
    const tab = tabs.find(t => t.key === key);
    if (!tab) return;
    setActiveKey(key);
    // Avoid duplicate history entries — only push if we're not already there.
    if (!location.pathname.startsWith(tab.path)) {
      history.push(tab.path);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    const len = tabs.length;
    let next: number | null = null;

    switch (e.key) {
      case 'ArrowRight': next = (index + 1) % len; break;
      case 'ArrowLeft':  next = (index - 1 + len) % len; break;
      case 'Home':       next = 0; break;
      case 'End':        next = len - 1; break;
      default: return; // don't preventDefault for unhandled keys
    }

    e.preventDefault();
    refs.current[next]?.focus();
    navigate(tabs[next].key);
  }

  return (
    <>
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        style={S.tabbar}
      >
        {tabs.map((tab, i) => {
          const active = displayKey === tab.key;
          return (
            <button
              key={tab.key}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="tab"
              id={`${testIdPrefix}-${tab.key}`}
              aria-selected={active}
              aria-controls={`${testIdPrefix}-panel-${tab.key}`}
              tabIndex={active ? 0 : -1}
              data-testid={`${testIdPrefix}-${tab.key}`}
              style={S.tab(active)}
              onClick={() => navigate(tab.key)}
              onKeyDown={(e) => handleKeyDown(e, i)}
            >
              {tab.label}
              {tab.tag && (
                <span style={S.tag}>{tab.tag}</span>
              )}
            </button>
          );
        })}
      </div>
      {children}
    </>
  );
}
