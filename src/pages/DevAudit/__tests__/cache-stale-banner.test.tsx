/**
 * Tests for CacheStaleBanner:
 * - hidden when staleRatio <= 0.25 (threshold)
 * - visible when staleRatio > 0.25
 * - shows correct stale % in message
 * - clear button triggers confirm + onClearCache
 * - dismiss hides banner without calling onClearCache
 * - sessionStorage dismiss persists within render (re-mount stays hidden)
 *
 * staleRatio is now the BE shape { stale, typed, legacy } (raw counts).
 * deriveStaleRatios() computes the [0,1] fraction used by the banner.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CacheStaleBanner } from '../cache-stale-banner';
import type { CacheEffectivenessResponse } from '../../../api/cache-effectiveness-types';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Build test data with a given stale fraction.
 * We express the fraction via raw counts: stale=fraction*100, typed=100, legacy=0
 * so deriveStaleRatios returns exactly the desired fraction.
 * e.g. makeData(0.26) → stale=26, typed=100 → 26/100 = 0.26.
 */
function makeData(staleFraction: number): CacheEffectivenessResponse {
  const stale = Math.round(staleFraction * 100);
  return {
    summary: {
      hitRate: 0.5,
      dollarsSaved: 10,
      tokensSaved: 1000,
      latencyWinMs: { avgHitMs: 200, avgMissMs: 3000 },
    },
    sparkline: [],
    topQueries: [],
    // typed=100 means denom=100; stale/100 = staleFraction
    staleRatio: { stale, typed: 100, legacy: 0 },
  };
}

const DISMISS_KEY = 'dev-audit:stale-banner-dismissed';

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear sessionStorage dismiss key before each test
  sessionStorage.removeItem(DISMISS_KEY);
  // Default confirm = true
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CacheStaleBanner', () => {
  it('does not render when staleRatio is 0.24 (below threshold)', () => {
    const { container } = render(
      <CacheStaleBanner data={makeData(0.24)} onClearCache={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not render when staleRatio equals threshold (0.25)', () => {
    const { container } = render(
      <CacheStaleBanner data={makeData(0.25)} onClearCache={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders when staleRatio is 0.26 (above threshold)', () => {
    render(<CacheStaleBanner data={makeData(0.26)} onClearCache={vi.fn()} />);
    expect(screen.getByTestId('stale-cache-banner')).toBeTruthy();
  });

  it('renders when staleRatio is 1.0 (fully stale)', () => {
    render(<CacheStaleBanner data={makeData(1.0)} onClearCache={vi.fn()} />);
    expect(screen.getByTestId('stale-cache-banner')).toBeTruthy();
  });

  it('shows rounded stale percent in banner text', () => {
    render(<CacheStaleBanner data={makeData(0.37)} onClearCache={vi.fn()} />);
    expect(screen.getByTestId('stale-cache-banner').textContent).toContain('37%');
  });

  it('shows game-specific clear label when gameId provided', () => {
    render(
      <CacheStaleBanner data={makeData(0.5)} onClearCache={vi.fn()} gameId="my-game" />,
    );
    expect(screen.getByTestId('stale-banner-clear-btn').textContent).toContain('my-game');
  });

  it('shows "all games" label when no gameId', () => {
    render(<CacheStaleBanner data={makeData(0.5)} onClearCache={vi.fn()} />);
    expect(screen.getByTestId('stale-banner-clear-btn').textContent).toContain('all games');
  });

  it('calls onClearCache when clear button is clicked and confirm is accepted', () => {
    const onClear = vi.fn();
    render(<CacheStaleBanner data={makeData(0.5)} onClearCache={onClear} />);
    fireEvent.click(screen.getByTestId('stale-banner-clear-btn'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('does not call onClearCache when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClear = vi.fn();
    render(<CacheStaleBanner data={makeData(0.5)} onClearCache={onClear} />);
    fireEvent.click(screen.getByTestId('stale-banner-clear-btn'));
    expect(onClear).not.toHaveBeenCalled();
  });

  it('hides banner after clear button is clicked (auto-dismiss)', () => {
    render(<CacheStaleBanner data={makeData(0.5)} onClearCache={vi.fn()} />);
    fireEvent.click(screen.getByTestId('stale-banner-clear-btn'));
    expect(screen.queryByTestId('stale-cache-banner')).toBeNull();
  });

  it('hides banner when dismiss button is clicked', () => {
    render(<CacheStaleBanner data={makeData(0.5)} onClearCache={vi.fn()} />);
    fireEvent.click(screen.getByTestId('stale-banner-dismiss-btn'));
    expect(screen.queryByTestId('stale-cache-banner')).toBeNull();
  });

  it('does not call onClearCache when dismiss button is clicked', () => {
    const onClear = vi.fn();
    render(<CacheStaleBanner data={makeData(0.5)} onClearCache={onClear} />);
    fireEvent.click(screen.getByTestId('stale-banner-dismiss-btn'));
    expect(onClear).not.toHaveBeenCalled();
  });

  it('stays hidden on remount when sessionStorage dismiss key is set', () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    const { container } = render(
      <CacheStaleBanner data={makeData(0.9)} onClearCache={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('derives stale fraction from BE counts — shows banner when stale/total > 0.25', () => {
    // BE shape: stale=30, typed=100, legacy=0 → staleRatio=30/100=0.30 > 0.25
    const data: CacheEffectivenessResponse = {
      ...makeData(0),
      staleRatio: { stale: 30, typed: 100, legacy: 0 },
    };
    render(<CacheStaleBanner data={data} onClearCache={vi.fn()} />);
    expect(screen.getByTestId('stale-cache-banner')).toBeTruthy();
  });

  it('legacy rows contribute to denom — mixed stale+legacy counts correctly', () => {
    // stale=10, typed=60, legacy=40 → denom=100 → staleRatio=0.10 (≤ threshold → hidden)
    const data: CacheEffectivenessResponse = {
      ...makeData(0),
      staleRatio: { stale: 10, typed: 60, legacy: 40 },
    };
    const { container } = render(
      <CacheStaleBanner data={data} onClearCache={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('empty cache (all zeros) hides banner', () => {
    const data: CacheEffectivenessResponse = {
      ...makeData(0),
      staleRatio: { stale: 0, typed: 0, legacy: 0 },
    };
    const { container } = render(
      <CacheStaleBanner data={data} onClearCache={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
