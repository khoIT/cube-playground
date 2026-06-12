/**
 * Tests for CacheDashboardPage (the cache tab orchestrator):
 * - loading state shows skeleton, not content
 * - error state shows error message
 * - all sections render when data is present and non-empty
 * - empty state shows when hitRate=0 and topQueries=[]
 * - filter selects are present with correct defaults
 * - refresh button is present
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CacheDashboardPage } from '../cache-dashboard-page';
import type { CacheEffectivenessResponse } from '../../../api/cache-effectiveness-types';

// ── mock game context ─────────────────────────────────────────────────────────
vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'ptg',
}));

// ── mock the fetch hook ───────────────────────────────────────────────────────
const mockRefresh = vi.fn();
vi.mock('../use-cache-effectiveness', () => ({
  useCacheEffectiveness: vi.fn(),
}));

import { useCacheEffectiveness } from '../use-cache-effectiveness';
const mockHook = vi.mocked(useCacheEffectiveness);

// ── fixtures ──────────────────────────────────────────────────────────────────
const FULL_DATA: CacheEffectivenessResponse = {
  summary: {
    hitRate: 0.73,
    dollarsSaved: 42.18,
    tokensSaved: 1_400_000,
    latencyWinMs: { avgHitMs: 180, avgMissMs: 4300 },
  },
  sparkline: [
    { day: '2026-05-01', hits: 10, misses: 2 },
    { day: '2026-05-02', hits: 15, misses: 3 },
  ],
  topQueries: [
    {
      queryKey: 'abc123',
      snippet: 'show dau by platform last 7d',
      skill: 'metric-explorer',
      model: 'sonnet',
      hitCount: 47,
      lastHitAt: Date.parse('2026-05-25T10:00:00Z'),
      dollarsSaved: 0.012 * 46,
      originalSessionId: 'ses_abc',
      originalTurnId: 'turn_1',
    },
  ],
  // BE shape: stale=5, typed=100, legacy=1 → staleRatio=5/101≈0.05, legacyRatio=1/101≈0.01
  staleRatio: { stale: 5, typed: 100, legacy: 1 },
};

const EMPTY_DATA: CacheEffectivenessResponse = {
  summary: {
    hitRate: 0,
    dollarsSaved: 0,
    tokensSaved: 0,
    latencyWinMs: { avgHitMs: null, avgMissMs: null },
  },
  sparkline: [],
  topQueries: [],
  staleRatio: { stale: 0, typed: 0, legacy: 0 },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CacheDashboardPage />
    </MemoryRouter>,
  );
}

describe('CacheDashboardPage', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
  });

  it('shows loading skeleton when isLoading=true', () => {
    mockHook.mockReturnValue({ data: null, isLoading: true, error: null, refresh: mockRefresh });
    renderPage();
    expect(screen.getByTestId('cache-loading-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('cache-hero-grid')).toBeNull();
    expect(screen.queryByTestId('top-queries-table')).toBeNull();
  });

  it('does not show skeleton when not loading', () => {
    mockHook.mockReturnValue({ data: FULL_DATA, isLoading: false, error: null, refresh: mockRefresh });
    renderPage();
    expect(screen.queryByTestId('cache-loading-skeleton')).toBeNull();
  });

  it('shows error message when error is set', () => {
    mockHook.mockReturnValue({ data: null, isLoading: false, error: '500 Internal Server Error', refresh: mockRefresh });
    renderPage();
    expect(screen.getByTestId('cache-error').textContent).toContain('500 Internal Server Error');
    expect(screen.queryByTestId('cache-hero-grid')).toBeNull();
  });

  it('renders hero grid and top queries table when data present', () => {
    mockHook.mockReturnValue({ data: FULL_DATA, isLoading: false, error: null, refresh: mockRefresh });
    renderPage();
    expect(screen.getByTestId('cache-hero-grid')).toBeTruthy();
    expect(screen.getByTestId('top-queries-table')).toBeTruthy();
  });

  it('shows empty state when hitRate=0 and topQueries=[]', () => {
    mockHook.mockReturnValue({ data: EMPTY_DATA, isLoading: false, error: null, refresh: mockRefresh });
    renderPage();
    expect(screen.getByTestId('cache-empty-state')).toBeTruthy();
    expect(screen.queryByTestId('cache-hero-grid')).toBeNull();
  });

  it('shows empty state hint about enabling cache', () => {
    mockHook.mockReturnValue({ data: EMPTY_DATA, isLoading: false, error: null, refresh: mockRefresh });
    renderPage();
    expect(screen.getByTestId('cache-empty-state').textContent).toContain('RESPONSE_CACHE_ENABLED');
  });

  it('filter bar contains days select with default 30', () => {
    mockHook.mockReturnValue({ data: FULL_DATA, isLoading: false, error: null, refresh: mockRefresh });
    renderPage();
    const sel = screen.getByTestId('cache-days-select') as HTMLSelectElement;
    expect(sel.value).toBe('30');
  });

  it('filter bar contains topN select with default 20', () => {
    mockHook.mockReturnValue({ data: FULL_DATA, isLoading: false, error: null, refresh: mockRefresh });
    renderPage();
    const sel = screen.getByTestId('cache-topn-select') as HTMLSelectElement;
    expect(sel.value).toBe('20');
  });

  it('refresh button is present', () => {
    mockHook.mockReturnValue({ data: FULL_DATA, isLoading: false, error: null, refresh: mockRefresh });
    renderPage();
    expect(screen.getByTestId('cache-refresh-btn')).toBeTruthy();
  });

  it('renders the cache dashboard page root container', () => {
    mockHook.mockReturnValue({ data: FULL_DATA, isLoading: false, error: null, refresh: mockRefresh });
    renderPage();
    expect(screen.getByTestId('cache-dashboard-page')).toBeTruthy();
  });
});
