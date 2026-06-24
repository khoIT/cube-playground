/**
 * Tests for SearchTab (unified search):
 * - Renders input + mode chips
 * - Empty state shown when no query
 * - Mode switch re-renders correct result list section
 * - URL state syncs: mode change pushes ?mode= to URL
 * - Input change debounces and pushes ?q= to URL
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock hooks so no real fetch calls happen
// ---------------------------------------------------------------------------

vi.mock('../use-debug-search', () => ({
  useDebugSearch: () => ({
    results: [],
    isLoading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));

vi.mock('../use-debug-sessions-search', () => ({
  useDebugSessionsSearch: () => ({
    results: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../use-debug-cached-queries-search', () => ({
  useDebugCachedQueriesSearch: () => ({
    results: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'game-x',
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { SearchTab } from '../search-tab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTab(initialSearch = '') {
  let capturedSearch = initialSearch;
  const utils = render(
    <MemoryRouter initialEntries={[`/dev/chat-audit/search${initialSearch}`]}>
      <Route path="/dev/chat-audit/search">
        <SearchTab />
      </Route>
      <Route
        path="*"
        render={({ location }) => {
          capturedSearch = location.search;
          return null;
        }}
      />
    </MemoryRouter>,
  );
  return { ...utils, getSearch: () => capturedSearch };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchTab — render', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the search input', () => {
    renderTab();
    expect(screen.getByTestId('unified-search-input')).toBeTruthy();
  });

  it('renders mode chips radiogroup', () => {
    renderTab();
    expect(screen.getByRole('radiogroup', { name: 'Search mode' })).toBeTruthy();
  });

  it('renders all 3 mode chips', () => {
    renderTab();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('defaults to turns mode when no ?mode= param', () => {
    renderTab();
    expect(screen.getByTestId('mode-chip-turns').getAttribute('aria-checked')).toBe('true');
  });

  it('restores mode from URL ?mode=sessions', () => {
    renderTab('?mode=sessions');
    expect(screen.getByTestId('mode-chip-sessions').getAttribute('aria-checked')).toBe('true');
  });

  it('restores mode from URL ?mode=cached', () => {
    renderTab('?mode=cached');
    expect(screen.getByTestId('mode-chip-cached').getAttribute('aria-checked')).toBe('true');
  });

  it('treats unknown ?mode= value as turns', () => {
    renderTab('?mode=evil');
    expect(screen.getByTestId('mode-chip-turns').getAttribute('aria-checked')).toBe('true');
  });
});

describe('SearchTab — default-list affordance (empty query)', () => {
  it('shows the recent-turns default label when query is blank (turns mode)', () => {
    renderTab();
    expect(screen.getByTestId('search-default-label')).toBeTruthy();
    expect(screen.getByText('Recent turns')).toBeTruthy();
    expect(screen.getByText(/Top 10 · start typing to search/)).toBeTruthy();
  });

  it('shows the recent-sessions default label in sessions mode with no query', () => {
    renderTab('?mode=sessions');
    expect(screen.getByText('Recent sessions')).toBeTruthy();
  });

  it('shows the top-cached-queries default label in cached mode with no query', () => {
    renderTab('?mode=cached');
    expect(screen.getByText('Top cached queries')).toBeTruthy();
  });

  it('hides the default label once a query is present', () => {
    renderTab('?q=retention&mode=turns');
    expect(screen.queryByTestId('search-default-label')).toBeNull();
  });
});

describe('SearchTab — mode switch via chip click', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clicking Sessions chip switches mode', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('mode-chip-sessions'));
    expect(screen.getByTestId('mode-chip-sessions').getAttribute('aria-checked')).toBe('true');
  });

  it('mode chip click pushes ?mode= to URL', () => {
    const { getSearch } = renderTab();
    fireEvent.click(screen.getByTestId('mode-chip-cached'));
    expect(getSearch()).toContain('mode=cached');
  });
});

describe('SearchTab — input debounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('input change does not push URL immediately', () => {
    const { getSearch } = renderTab();
    fireEvent.change(screen.getByTestId('unified-search-input'), {
      target: { value: 'retention' },
    });
    // Before debounce fires, URL still has no q param
    expect(getSearch()).not.toContain('q=retention');
  });

  it('input change pushes ?q= to URL after 300ms debounce', () => {
    const { getSearch } = renderTab();
    fireEvent.change(screen.getByTestId('unified-search-input'), {
      target: { value: 'retention' },
    });
    act(() => { vi.advanceTimersByTime(300); });
    expect(getSearch()).toContain('q=retention');
  });

  it('URL restores input value on mount', () => {
    renderTab('?q=dau&mode=turns');
    const input = screen.getByTestId('unified-search-input') as HTMLInputElement;
    expect(input.value).toBe('dau');
  });
});
