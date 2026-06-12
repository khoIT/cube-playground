/**
 * Tests for DevAuditShell redirects:
 * - /dev/chat-audit (exact) → /dev/chat-audit/sessions
 * - /dev/chat-audit/abc-123 (legacy bare ID) → /dev/chat-audit/sessions/abc-123
 * - /dev/chat-audit/sessions renders sessions tab (not redirected)
 * - /dev/chat-audit/leaderboard renders leaderboard content
 * - /dev/chat-audit/cache renders cache tab
 * - /dev/chat-audit/search renders search tab
 *
 * Shell deps (useActiveGameId, SessionsTab sub-components) are mocked to keep
 * tests focused on routing logic only.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy sub-components so routing tests stay unit-level
// ---------------------------------------------------------------------------

vi.mock('../sessions-tab', () => ({
  SessionsTab: () => <div data-testid="sessions-tab">SessionsTab</div>,
}));

vi.mock('../search-tab', () => ({
  SearchTab: () => <div data-testid="search-tab">SearchTab</div>,
}));

vi.mock('../cache-tab', () => ({
  CacheTab: () => <div data-testid="cache-tab">CacheTab</div>,
}));

vi.mock('../skill-leaderboard-page', () => ({
  SkillLeaderboardPage: () => <div data-testid="leaderboard-tab">LeaderboardTab</div>,
}));

vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'game-test',
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { DevAuditShell } from '../dev-audit-shell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderShell(initialPath: string, initialHash = '') {
  let finalPath = initialPath;
  let finalHash = initialHash;
  render(
    <MemoryRouter initialEntries={[{ pathname: initialPath, hash: initialHash }]}>
      <Route path="/dev/chat-audit">
        <DevAuditShell />
      </Route>
      {/* Capture the resolved path + hash after any redirects */}
      <Route
        path="*"
        render={({ location }) => {
          finalPath = location.pathname;
          finalHash = location.hash;
          return null;
        }}
      />
    </MemoryRouter>,
  );
  return { getPath: () => finalPath, getHash: () => finalHash };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DevAuditShell — default redirect', () => {
  it('redirects /dev/chat-audit to /dev/chat-audit/sessions', () => {
    const { getPath } = renderShell('/dev/chat-audit');
    expect(getPath()).toBe('/dev/chat-audit/sessions');
  });
});

describe('DevAuditShell — legacy redirect', () => {
  it('redirects /dev/chat-audit/abc-123 to /dev/chat-audit/sessions/abc-123', () => {
    const { getPath } = renderShell('/dev/chat-audit/abc-123');
    expect(getPath()).toBe('/dev/chat-audit/sessions/abc-123');
  });

  it('redirects /dev/chat-audit/sess-xyz to /dev/chat-audit/sessions/sess-xyz', () => {
    const { getPath } = renderShell('/dev/chat-audit/sess-xyz');
    expect(getPath()).toBe('/dev/chat-audit/sessions/sess-xyz');
  });

  it('preserves #hash anchor on legacy redirect', () => {
    // Bookmarks like /dev/chat-audit/abc-123#turn-xyz must keep #turn-xyz after redirect.
    const { getPath, getHash } = renderShell('/dev/chat-audit/abc-123', '#turn-xyz');
    expect(getPath()).toBe('/dev/chat-audit/sessions/abc-123');
    expect(getHash()).toBe('#turn-xyz');
  });
});

describe('DevAuditShell — tab rendering', () => {
  it('renders SessionsTab at /dev/chat-audit/sessions', () => {
    renderShell('/dev/chat-audit/sessions');
    expect(screen.getByTestId('sessions-tab')).toBeTruthy();
  });

  it('renders SessionsTab at /dev/chat-audit/sessions/some-id', () => {
    renderShell('/dev/chat-audit/sessions/some-id');
    expect(screen.getByTestId('sessions-tab')).toBeTruthy();
  });

  it('renders SearchTab at /dev/chat-audit/search', () => {
    renderShell('/dev/chat-audit/search');
    expect(screen.getByTestId('search-tab')).toBeTruthy();
  });

  it('renders LeaderboardTab at /dev/chat-audit/leaderboard', () => {
    renderShell('/dev/chat-audit/leaderboard');
    expect(screen.getByTestId('leaderboard-tab')).toBeTruthy();
  });

  it('renders CacheTab at /dev/chat-audit/cache', () => {
    renderShell('/dev/chat-audit/cache');
    expect(screen.getByTestId('cache-tab')).toBeTruthy();
  });
});

describe('DevAuditShell — tab nav present', () => {
  it('renders the AuditTabs tablist', () => {
    renderShell('/dev/chat-audit/sessions');
    expect(screen.getByRole('tablist', { name: 'Chat Audit' })).toBeTruthy();
  });

  it('renders all 4 tabs in the tablist', () => {
    renderShell('/dev/chat-audit/sessions');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
  });

  it('shows the game badge in the banner', () => {
    renderShell('/dev/chat-audit/sessions');
    expect(screen.getByText(/game: game-test/)).toBeTruthy();
  });
});
