/**
 * Tests for AuditTabs:
 * - Renders all 4 tabs with correct ARIA roles
 * - Correct tab is aria-selected based on current URL
 * - Clicking a tab triggers navigation
 * - ArrowLeft/ArrowRight keyboard cycling
 * - resolveAuditTab helper
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { AuditTabs, resolveAuditTab } from '../audit-tabs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTabs(pathname: string) {
  let currentPath = pathname;
  const utils = render(
    <MemoryRouter initialEntries={[pathname]}>
      <AuditTabs />
      <Route
        path="*"
        render={({ location }) => {
          currentPath = location.pathname;
          return <div data-testid="cur-path">{location.pathname}</div>;
        }}
      />
    </MemoryRouter>,
  );
  return { ...utils, getPath: () => currentPath };
}

// ---------------------------------------------------------------------------
// resolveAuditTab unit tests
// ---------------------------------------------------------------------------

describe('resolveAuditTab', () => {
  it('returns sessions for /dev/chat-audit/sessions', () => {
    expect(resolveAuditTab('/dev/chat-audit/sessions')).toBe('sessions');
  });

  it('returns sessions for /dev/chat-audit/sessions/abc-123', () => {
    expect(resolveAuditTab('/dev/chat-audit/sessions/abc-123')).toBe('sessions');
  });

  it('returns search for /dev/chat-audit/search', () => {
    expect(resolveAuditTab('/dev/chat-audit/search')).toBe('search');
  });

  it('returns leaderboard for /dev/chat-audit/leaderboard', () => {
    expect(resolveAuditTab('/dev/chat-audit/leaderboard')).toBe('leaderboard');
  });

  it('returns cache for /dev/chat-audit/cache', () => {
    expect(resolveAuditTab('/dev/chat-audit/cache')).toBe('cache');
  });

  it('defaults to sessions for unrecognised paths', () => {
    expect(resolveAuditTab('/dev/chat-audit')).toBe('sessions');
    expect(resolveAuditTab('/dev/chat-audit/abc-legacy')).toBe('sessions');
  });
});

// ---------------------------------------------------------------------------
// AuditTabs render tests
// ---------------------------------------------------------------------------

describe('AuditTabs', () => {
  it('renders 4 tabs with role=tab', () => {
    renderTabs('/dev/chat-audit/sessions');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
  });

  it('tablist has correct aria-label', () => {
    renderTabs('/dev/chat-audit/sessions');
    expect(screen.getByRole('tablist', { name: 'Chat Audit' })).toBeTruthy();
  });

  it('tab labels are Sessions, Search, Leaderboard, Cache', () => {
    renderTabs('/dev/chat-audit/sessions');
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Sessions', 'Search', 'Leaderboard', 'Cache']);
  });

  it('Sessions tab is aria-selected at /dev/chat-audit/sessions', () => {
    renderTabs('/dev/chat-audit/sessions');
    expect(screen.getByRole('tab', { name: 'Sessions' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Search' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Leaderboard' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Cache' }).getAttribute('aria-selected')).toBe('false');
  });

  it('Search tab is aria-selected at /dev/chat-audit/search', () => {
    renderTabs('/dev/chat-audit/search');
    expect(screen.getByRole('tab', { name: 'Search' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Sessions' }).getAttribute('aria-selected')).toBe('false');
  });

  it('Leaderboard tab is aria-selected at /dev/chat-audit/leaderboard', () => {
    renderTabs('/dev/chat-audit/leaderboard');
    expect(screen.getByRole('tab', { name: 'Leaderboard' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Cache tab is aria-selected at /dev/chat-audit/cache', () => {
    renderTabs('/dev/chat-audit/cache');
    expect(screen.getByRole('tab', { name: 'Cache' }).getAttribute('aria-selected')).toBe('true');
  });

  it('clicking Search tab navigates to /dev/chat-audit/search', () => {
    const { getPath } = renderTabs('/dev/chat-audit/sessions');
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
    expect(getPath()).toBe('/dev/chat-audit/search');
  });

  it('clicking Leaderboard tab navigates to /dev/chat-audit/leaderboard', () => {
    const { getPath } = renderTabs('/dev/chat-audit/sessions');
    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    expect(getPath()).toBe('/dev/chat-audit/leaderboard');
  });

  it('clicking Cache tab navigates to /dev/chat-audit/cache', () => {
    const { getPath } = renderTabs('/dev/chat-audit/sessions');
    fireEvent.click(screen.getByRole('tab', { name: 'Cache' }));
    expect(getPath()).toBe('/dev/chat-audit/cache');
  });

  it('active tab has tabIndex=0, inactive tabs have tabIndex=-1', () => {
    renderTabs('/dev/chat-audit/sessions');
    expect(screen.getByRole('tab', { name: 'Sessions' }).getAttribute('tabIndex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Search' }).getAttribute('tabIndex')).toBe('-1');
  });

  it('ArrowRight from Sessions focuses and navigates to Search', () => {
    const { getPath } = renderTabs('/dev/chat-audit/sessions');
    const sessionsTab = screen.getByRole('tab', { name: 'Sessions' });
    fireEvent.keyDown(sessionsTab, { key: 'ArrowRight' });
    expect(getPath()).toBe('/dev/chat-audit/search');
  });

  it('ArrowLeft from Sessions wraps to Cache', () => {
    const { getPath } = renderTabs('/dev/chat-audit/sessions');
    const sessionsTab = screen.getByRole('tab', { name: 'Sessions' });
    fireEvent.keyDown(sessionsTab, { key: 'ArrowLeft' });
    expect(getPath()).toBe('/dev/chat-audit/cache');
  });

  it('Home key navigates to first tab (Sessions)', () => {
    const { getPath } = renderTabs('/dev/chat-audit/cache');
    const cacheTab = screen.getByRole('tab', { name: 'Cache' });
    fireEvent.keyDown(cacheTab, { key: 'Home' });
    expect(getPath()).toBe('/dev/chat-audit/sessions');
  });

  it('End key navigates to last tab (Cache)', () => {
    const { getPath } = renderTabs('/dev/chat-audit/sessions');
    const sessionsTab = screen.getByRole('tab', { name: 'Sessions' });
    fireEvent.keyDown(sessionsTab, { key: 'End' });
    expect(getPath()).toBe('/dev/chat-audit/cache');
  });
});
