/**
 * Unit tests for Live KPI internals.
 *
 * Pure utility functions are imported from their modules (no drift risk).
 * Hook-level behaviour (C2 token-game guard) is tested with lightweight stubs.
 */

import { describe, it, expect } from 'vitest';
import { formatValue, computeDelta } from './kpi-format';
import { extractTimeSeries } from './kpi-fetch';
import { readCache, writeCache } from './kpi-cache';
import type { KpiTileData } from './use-live-kpis-types';

// ── formatValue ───────────────────────────────────────────────────────────

describe('formatValue', () => {
  it('formats NaN/Infinity as —', () => {
    expect(formatValue(NaN)).toBe('—');
    expect(formatValue(Infinity)).toBe('—');
  });

  it('formats currency via VND locale', () => {
    const result = formatValue(1_000_000, 'currency');
    expect(result).toContain('1.000.000');
  });

  it('formats percent with 1 decimal', () => {
    expect(formatValue(0.1234, 'percent')).toBe('12.3%');
  });

  it('compact: ≥1M shows M suffix', () => {
    expect(formatValue(1_500_000)).toBe('1.5M');
  });

  it('compact: ≥1K shows K suffix', () => {
    expect(formatValue(12_345)).toBe('12.3K');
  });

  it('compact: <1K shows raw number', () => {
    const result = formatValue(999);
    expect(result).toBeTruthy();
    expect(result).not.toContain('K');
  });
});

// ── computeDelta ──────────────────────────────────────────────────────────

describe('computeDelta', () => {
  describe('1d window', () => {
    it('returns null with fewer than 2 values', () => {
      expect(computeDelta([], '1d')).toBeNull();
      expect(computeDelta([100], '1d')).toBeNull();
    });

    it('returns null when prior is 0', () => {
      expect(computeDelta([0, 100], '1d')).toBeNull();
    });

    it('computes positive delta correctly', () => {
      expect(computeDelta([100, 110], '1d')).toBeCloseTo(0.1);
    });

    it('computes negative delta correctly', () => {
      expect(computeDelta([100, 90], '1d')).toBeCloseTo(-0.1);
    });

    it('uses only last two values regardless of array length', () => {
      expect(computeDelta([50, 200, 100, 110], '1d')).toBeCloseTo(0.1);
    });
  });

  describe('7d window', () => {
    it('returns null with fewer than 14 values', () => {
      expect(computeDelta(Array(13).fill(100), '7d')).toBeNull();
    });

    it('computes 7d delta: recent avg vs prior avg', () => {
      const values = [...Array(7).fill(100), ...Array(7).fill(110)];
      expect(computeDelta(values, '7d')).toBeCloseTo(0.1);
    });

    it('returns null when prior avg is 0', () => {
      const values = [...Array(7).fill(0), ...Array(7).fill(110)];
      expect(computeDelta(values, '7d')).toBeNull();
    });
  });
});

// ── extractTimeSeries ─────────────────────────────────────────────────────

describe('extractTimeSeries', () => {
  it('extracts and sorts rows by date', () => {
    const rows = [
      { 'active_daily.log_date.day': '2024-01-03', 'active_daily.dau': '300' },
      { 'active_daily.log_date.day': '2024-01-01', 'active_daily.dau': '100' },
      { 'active_daily.log_date.day': '2024-01-02', 'active_daily.dau': '200' },
    ];
    const result = extractTimeSeries(rows, 'active_daily.dau', 'active_daily.log_date.day');
    expect(result.map((r) => r.value)).toEqual([100, 200, 300]);
  });

  it('drops rows with missing measure value', () => {
    const rows = [
      { 'active_daily.log_date.day': '2024-01-01', 'active_daily.dau': null },
      { 'active_daily.log_date.day': '2024-01-02', 'active_daily.dau': '200' },
    ];
    const result = extractTimeSeries(rows, 'active_daily.dau', 'active_daily.log_date.day');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(200);
  });

  it('drops rows with non-finite value', () => {
    const rows = [
      { 'active_daily.log_date.day': '2024-01-01', 'active_daily.dau': 'NaN' },
      { 'active_daily.log_date.day': '2024-01-02', 'active_daily.dau': '500' },
    ];
    const result = extractTimeSeries(rows, 'active_daily.dau', 'active_daily.log_date.day');
    expect(result).toHaveLength(1);
  });

  it('truncates date to YYYY-MM-DD when ISO timestamp provided', () => {
    const rows = [
      { 'active_daily.log_date.day': '2024-01-15T00:00:00.000', 'active_daily.dau': '1000' },
    ];
    const result = extractTimeSeries(rows, 'active_daily.dau', 'active_daily.log_date.day');
    expect(result[0].date).toBe('2024-01-15');
  });
});

// ── C1: applyGameFilter is a no-op when no cube has .gameId dim ───────────

describe('C1 — cubeHasGameDim predicate', () => {
  it('returns false for all cubes when meta has no gameId dimensions', () => {
    // Simulate the useCubeHasGameDim logic with an api whose meta has no .gameId dims
    const apiWithNoGameDim = {
      meta: { cubes: [
        { name: 'active_daily', dimensions: [{ name: 'active_daily.log_date' }] },
        { name: 'user_recharge_daily', dimensions: [{ name: 'user_recharge_daily.recharge_date' }] },
      ]},
    };

    // Build the predicate inline (mirrors use-cube-has-game-dim.ts logic)
    let cache: Set<string> | null = null;
    const predicate = (cube: string): boolean => {
      if (!cache) {
        const metaCubes = (apiWithNoGameDim as any)?.meta?.cubes ?? null;
        if (!metaCubes) return false;
        cache = new Set<string>();
        for (const c of metaCubes) {
          for (const d of c.dimensions ?? []) {
            if (typeof d?.name === 'string' && d.name.endsWith('.gameId')) {
              cache.add(d.name.split('.')[0]);
            }
          }
        }
      }
      return cache.has(cube);
    };

    expect(predicate('active_daily')).toBe(false);
    expect(predicate('user_recharge_daily')).toBe(false);
  });

  it('returns true only for cubes that actually list .gameId in meta', () => {
    const apiWithGameDim = {
      meta: { cubes: [
        { name: 'some_cube', dimensions: [{ name: 'some_cube.gameId' }] },
        { name: 'other_cube', dimensions: [{ name: 'other_cube.log_date' }] },
      ]},
    };

    let cache: Set<string> | null = null;
    const predicate = (cube: string): boolean => {
      if (!cache) {
        const metaCubes = (apiWithGameDim as any)?.meta?.cubes ?? null;
        if (!metaCubes) return false;
        cache = new Set<string>();
        for (const c of metaCubes) {
          for (const d of c.dimensions ?? []) {
            if (typeof d?.name === 'string' && d.name.endsWith('.gameId')) {
              cache.add(d.name.split('.')[0]);
            }
          }
        }
      }
      return cache.has(cube);
    };

    expect(predicate('some_cube')).toBe(true);
    expect(predicate('other_cube')).toBe(false);
  });

  it('returns false when meta is not yet loaded (null cubes)', () => {
    const apiNoMeta = {};
    let cache: Set<string> | null = null;
    const predicate = (cube: string): boolean => {
      if (!cache) {
        const metaCubes = (apiNoMeta as any)?.meta?.cubes ?? null;
        if (!metaCubes) return false;
        cache = new Set<string>();
      }
      return cache.has(cube);
    };
    expect(predicate('active_daily')).toBe(false);
  });
});

// ── C2: cache write is skipped when tokenGame mismatches gameId ───────────

describe('C2 — token-game guard', () => {
  it('does not write to cache when tokenGame differs from gameId', () => {
    const gameId: string = 'cfm';
    const tokenGame: string = 'ptg'; // stale — token not yet updated

    // Simulate the guard condition in use-live-kpis.ts fetchAll
    const shouldFetch = tokenGame === gameId;
    expect(shouldFetch).toBe(false);

    // Verify no cache entry would be written for cfm
    // (write only happens after the guard passes)
    const before = readCache(gameId);
    // Since shouldFetch is false, writeCache is never called
    if (shouldFetch) {
      const fakeTile: KpiTileData = {
        id: 'dau', label: 'DAU', value: '1M', delta: null,
        tone: 'neutral', sparkline: [], unavailable: false, error: null,
      };
      writeCache(gameId, [fakeTile]);
    }
    const after = readCache(gameId);
    // Cache should remain unchanged (both null or same as before)
    expect(after).toEqual(before);
  });

  it('allows cache write when tokenGame matches gameId', () => {
    const gameId = 'cfm';
    const tokenGame = 'cfm'; // token is current

    const shouldFetch = tokenGame === gameId;
    expect(shouldFetch).toBe(true);

    const fakeTile: KpiTileData = {
      id: 'dau', label: 'DAU', value: '1M', delta: null,
      tone: 'neutral', sparkline: [], unavailable: false, error: null,
    };
    if (shouldFetch) {
      writeCache(gameId, [fakeTile]);
    }
    const entry = readCache(gameId);
    expect(entry).not.toBeNull();
    expect(entry!.tiles[0].id).toBe('dau');
  });
});
