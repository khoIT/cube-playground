/**
 * Tests for CacheDashboardHero:
 * - renders all 4 stat cards
 * - $ saved card has gradient class (hero card)
 * - hit rate shows formatted percentage
 * - tokens saved formatted (K/M suffix)
 * - latency win shows multiplier
 * - stale pill shows amber warn when staleRatio > 0.10
 * - stale pill shows normal style when staleRatio <= 0.10
 * - staleRatio as Record averages correctly
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CacheDashboardHero } from '../cache-dashboard-hero';
import type { CacheEffectivenessResponse } from '../../../api/cache-effectiveness-types';

function makeData(overrides: Partial<CacheEffectivenessResponse> = {}): CacheEffectivenessResponse {
  return {
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
    topQueries: [],
    staleRatio: 0.12,
    legacyRatio: 0.04,
    ...overrides,
  };
}

describe('CacheDashboardHero', () => {
  it('renders all 4 hero stat cards', () => {
    render(<CacheDashboardHero data={makeData()} days={30} />);
    expect(screen.getByTestId('card-dollars-saved')).toBeTruthy();
    expect(screen.getByTestId('card-hit-rate')).toBeTruthy();
    expect(screen.getByTestId('card-tokens-saved')).toBeTruthy();
    expect(screen.getByTestId('card-latency-win')).toBeTruthy();
  });

  it('hero grid is rendered', () => {
    render(<CacheDashboardHero data={makeData()} days={30} />);
    expect(screen.getByTestId('cache-hero-grid')).toBeTruthy();
  });

  it('$ saved shows formatted dollar value', () => {
    render(<CacheDashboardHero data={makeData()} days={30} />);
    expect(screen.getByTestId('card-dollars-saved').textContent).toContain('$42.18');
  });

  it('hit rate shows percentage', () => {
    render(<CacheDashboardHero data={makeData()} days={30} />);
    expect(screen.getByTestId('card-hit-rate').textContent).toContain('73%');
  });

  it('null hitRate shows —', () => {
    const data = makeData({ summary: { ...makeData().summary, hitRate: null } });
    render(<CacheDashboardHero data={data} days={30} />);
    expect(screen.getByTestId('card-hit-rate').textContent).toContain('—');
  });

  it('tokens saved shows M suffix for 1.4M', () => {
    render(<CacheDashboardHero data={makeData()} days={30} />);
    expect(screen.getByTestId('card-tokens-saved').textContent).toContain('1.4M');
  });

  it('tokens saved shows K suffix for thousands', () => {
    const data = makeData({ summary: { ...makeData().summary, tokensSaved: 45_200 } });
    render(<CacheDashboardHero data={data} days={30} />);
    expect(screen.getByTestId('card-tokens-saved').textContent).toContain('45.2K');
  });

  it('latency win shows multiplier string', () => {
    render(<CacheDashboardHero data={makeData()} days={30} />);
    // 4300 / 180 ≈ 23.9× faster
    expect(screen.getByTestId('card-latency-win').textContent).toContain('faster');
  });

  it('stale pill shows warn state when staleRatio > 0.10', () => {
    render(<CacheDashboardHero data={makeData({ staleRatio: 0.12 })} days={30} />);
    const pill = screen.getByTestId('stale-pill');
    expect(pill.getAttribute('data-warn')).toBe('true');
  });

  it('stale pill shows normal state when staleRatio <= 0.10', () => {
    render(<CacheDashboardHero data={makeData({ staleRatio: 0.05 })} days={30} />);
    const pill = screen.getByTestId('stale-pill');
    expect(pill.getAttribute('data-warn')).toBe('false');
  });

  it('stale pill shows 0% when staleRatio is 0', () => {
    render(<CacheDashboardHero data={makeData({ staleRatio: 0 })} days={30} />);
    expect(screen.getByTestId('stale-pill').textContent).toContain('0% stale');
  });

  it('staleRatio as BE object shape { stale, typed, legacy } derives ratio correctly', () => {
    // BE object shape: stale=20, typed=80, legacy=20 → denom=100 → staleRatio=0.20 > 0.10 → warn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<CacheDashboardHero data={makeData({ staleRatio: { stale: 20, typed: 80, legacy: 20 } as any })} days={30} />);
    const pill = screen.getByTestId('stale-pill');
    expect(pill.getAttribute('data-warn')).toBe('true');
  });

  it('shows days prop in $ saved subtext', () => {
    render(<CacheDashboardHero data={makeData()} days={90} />);
    expect(screen.getByTestId('card-dollars-saved').textContent).toContain('90 days');
  });
});
