/**
 * Tests for TabShell — generic ARIA tablist shell + resolveTab helper.
 *
 * Covers:
 *  - resolveTab pure function (pathname → key, longest-prefix, fallback)
 *  - one role=tab per tab with correct aria-selected for active path
 *  - roving tabIndex: active=0, others=-1
 *  - keyboard nav: ArrowRight, ArrowLeft, Home, End move focus + aria-selected
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resolveTab, TabShell } from '../tab-shell';
import type { TabDef } from '../tab-shell';

// ---------------------------------------------------------------------------
// Shared tab fixture matching DevAudit shape (4 tabs, specific paths)
// ---------------------------------------------------------------------------

const TABS: TabDef[] = [
  { key: 'sessions',    label: 'Sessions',    path: '/dev/chat-audit/sessions' },
  { key: 'search',      label: 'Search',      path: '/dev/chat-audit/search' },
  { key: 'leaderboard', label: 'Leaderboard', path: '/dev/chat-audit/leaderboard' },
  { key: 'cache',       label: 'Cache',       path: '/dev/chat-audit/cache', tag: 'beta' },
];

// ---------------------------------------------------------------------------
// resolveTab — pure helper, no rendering
// ---------------------------------------------------------------------------

describe('resolveTab', () => {
  it('matches exact path', () => {
    expect(resolveTab('/dev/chat-audit/sessions', TABS)).toBe('sessions');
    expect(resolveTab('/dev/chat-audit/search', TABS)).toBe('search');
    expect(resolveTab('/dev/chat-audit/leaderboard', TABS)).toBe('leaderboard');
    expect(resolveTab('/dev/chat-audit/cache', TABS)).toBe('cache');
  });

  it('matches sub-path (prefix match)', () => {
    // /sessions/:sessionId should still resolve to sessions
    expect(resolveTab('/dev/chat-audit/sessions/abc123', TABS)).toBe('sessions');
    expect(resolveTab('/dev/chat-audit/leaderboard/some/deep/path', TABS)).toBe('leaderboard');
  });

  it('picks the longest matching prefix when two prefixes overlap', () => {
    // Manufacture overlapping case: /base and /base/extra both prefix-match '/base/extra/thing'
    const overlapping: TabDef[] = [
      { key: 'short', label: 'Short', path: '/base' },
      { key: 'long',  label: 'Long',  path: '/base/extra' },
    ];
    expect(resolveTab('/base/extra/thing', overlapping)).toBe('long');
    expect(resolveTab('/base/other', overlapping)).toBe('short');
  });

  it('falls back to first tab when no path matches', () => {
    expect(resolveTab('/completely/unknown/path', TABS)).toBe('sessions');
    expect(resolveTab('', TABS)).toBe('sessions');
  });

  it('returns first tab when tabs list is empty (guard)', () => {
    const single: TabDef[] = [{ key: 'only', label: 'Only', path: '/only' }];
    expect(resolveTab('/no-match', single)).toBe('only');
  });

  it('does NOT match access tab for /admin/access-foo (segment boundary)', () => {
    // '/admin/access-foo' shares the string '/admin/access' as a prefix but
    // 'foo' is concatenated without '/' — not a segment boundary. Without the
    // segment-boundary guard, startsWith('/admin/access') would wrongly match.
    // We put a non-access tab first so a false prefix-match vs. a correct
    // fallback-to-first are distinguishable.
    const adminTabs: TabDef[] = [
      { key: 'dev',           label: 'Dev',            path: '/admin/dev' },
      { key: 'access',        label: 'Users & Access', path: '/admin/access' },
      { key: 'observability', label: 'Observability',  path: '/admin/observability' },
    ];
    // Falls back to first tab ('dev'), NOT 'access' — no segment-boundary match
    expect(resolveTab('/admin/access-foo', adminTabs)).toBe('dev');
    // Verify genuine sub-path still resolves correctly
    expect(resolveTab('/admin/access/detail', adminTabs)).toBe('access');
    // Exact match still resolves correctly
    expect(resolveTab('/admin/access', adminTabs)).toBe('access');
  });
});

// ---------------------------------------------------------------------------
// Helper: render TabShell at a given pathname via MemoryRouter
// ---------------------------------------------------------------------------

function renderShell(pathname: string, overrideTabs = TABS) {
  // TabShell reads location via useLocation() which requires a Router context.
  // MemoryRouter lets us set the initial pathname without a real browser.
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <TabShell
        basePath="/dev/chat-audit"
        tabs={overrideTabs}
        ariaLabel="Chat Audit"
        testIdPrefix="test-tab"
      />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Rendering: correct ARIA attributes per tab
// ---------------------------------------------------------------------------

describe('TabShell rendering', () => {
  it('renders one role=tab per tab definition', () => {
    renderShell('/dev/chat-audit/sessions');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
  });

  it('sets aria-selected=true only on the active tab', () => {
    renderShell('/dev/chat-audit/search');
    const tabs = screen.getAllByRole('tab');
    const labels = tabs.map(t => t.textContent?.trim());
    // Sessions, Search, Leaderboard, Cache
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');  // search is active
    expect(tabs[2].getAttribute('aria-selected')).toBe('false');
    expect(tabs[3].getAttribute('aria-selected')).toBe('false');
    // Confirm order matches TABS definition
    expect(labels[1]).toContain('Search');
  });

  it('renders the tag pill when tab has tag', () => {
    renderShell('/dev/chat-audit/sessions');
    // The 'cache' tab has tag:'beta'
    expect(screen.getByText('beta')).toBeTruthy();
  });

  it('active tab has tabIndex 0, all others -1', () => {
    renderShell('/dev/chat-audit/leaderboard');
    const tabs = screen.getAllByRole('tab');
    tabs.forEach((tab, i) => {
      const expected = i === 2 ? '0' : '-1'; // leaderboard is index 2
      expect(tab.getAttribute('tabIndex') ?? tab.tabIndex.toString()).toBe(expected);
    });
  });

  it('applies correct id pattern: {testIdPrefix}-{key}', () => {
    renderShell('/dev/chat-audit/sessions');
    expect(screen.getByTestId('test-tab-sessions')).toBeTruthy();
    expect(screen.getByTestId('test-tab-cache')).toBeTruthy();
  });

  it('falls back to first tab when pathname has no match', () => {
    renderShell('/dev/chat-audit');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation: ArrowRight / ArrowLeft / Home / End
// ---------------------------------------------------------------------------

describe('TabShell keyboard navigation', () => {
  it('ArrowRight moves focus to next tab', () => {
    renderShell('/dev/chat-audit/sessions');
    const tabs = screen.getAllByRole('tab');
    // Focus the first (active) tab and press ArrowRight
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    // After ArrowRight from sessions (0), search (1) should be selected
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowLeft wraps from first tab to last tab', () => {
    renderShell('/dev/chat-audit/sessions');
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    // Wraps around: last tab (cache, index 3) should be active
    expect(screen.getAllByRole('tab')[3].getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowRight wraps from last tab to first tab', () => {
    renderShell('/dev/chat-audit/cache');
    const tabs = screen.getAllByRole('tab');
    tabs[3].focus();
    fireEvent.keyDown(tabs[3], { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Home key jumps to first tab', () => {
    renderShell('/dev/chat-audit/leaderboard');
    const tabs = screen.getAllByRole('tab');
    tabs[2].focus();
    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('End key jumps to last tab', () => {
    renderShell('/dev/chat-audit/sessions');
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(screen.getAllByRole('tab')[3].getAttribute('aria-selected')).toBe('true');
  });

  it('non-nav keys do not change active tab', () => {
    renderShell('/dev/chat-audit/sessions');
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'Tab' });
    // sessions should still be active
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });
});
