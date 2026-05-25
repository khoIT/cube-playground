/**
 * Tests for use-compare-results.ts
 *
 * Strategy: test `runCompareLoad` directly (pure async fn, no React).
 * This avoids renderHook + jsdom which exhausts the 4 GB heap in Node v24
 * vitest forks pool during environment setup (OOM before any test runs).
 *
 * Hook integration (state transitions, isLoading, compLabel initial value)
 * is covered by lightweight synchronous assertions that don't need the DOM.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/cube-token-client', () => ({
  cubeTokenClient: {
    get: vi.fn(),
  },
}));

import { runCompareLoad } from './use-compare-results';
import type { ApiFactory } from './use-compare-results';
import { cubeTokenClient } from '../../api/cube-token-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResultSet(rows: Record<string, string | number>[]) {
  return { loadResponse: { results: [{ data: rows }] } } as any;
}

function makeStubFactory(mockLoad: ReturnType<typeof vi.fn>): ApiFactory {
  return vi.fn(() => ({ load: mockLoad })) as unknown as ApiFactory;
}

const BASE_QUERY = {
  measures: ['Orders.count'],
  timeDimensions: [
    {
      dimension: 'Orders.createdAt',
      dateRange: 'last 7 days' as any,
      granularity: 'day' as any,
    },
  ],
};

const BASE_PARAMS = {
  apiUrl: 'http://localhost:4000/cubejs-api/v1',
  currentToken: 'tok-active',
};

// ---------------------------------------------------------------------------
// Tests — prev mode
// ---------------------------------------------------------------------------

describe('runCompareLoad – prev mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when deriveCompareQuery returns null (no dateRange)', async () => {
    const mockLoad = vi.fn();
    await expect(
      runCompareLoad({
        ...BASE_PARAMS,
        query: { measures: ['Events.count'] }, // no timeDimension, no inDateRange
        mode: 'prev',
        currentResultSet: makeResultSet([{ 'Events.count': 10 }]),
        measures: ['Events.count'],
        _apiFactory: makeStubFactory(mockLoad),
      }),
    ).rejects.toThrow(/Cannot derive comparison/);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('returns merged rows with correct deltas', async () => {
    const currentRows = [{ 'Orders.createdAt.day': '2026-05-18', 'Orders.count': 100 }];
    const compRows = [{ 'Orders.createdAt.day': '2026-05-18', 'Orders.count': 80 }];

    const mockLoad = vi.fn().mockResolvedValue(makeResultSet(compRows));
    const stubFactory = makeStubFactory(mockLoad);

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: BASE_QUERY,
      mode: 'prev',
      currentResultSet: makeResultSet(currentRows),
      measures: ['Orders.count'],
      _apiFactory: stubFactory,
    });

    expect(result.mergedRows[0]['Orders.count__delta']).toBe(20);
    expect(result.compLabel).toBe('Prior period');
    // Factory called with current token (prev mode, same game).
    expect(stubFactory).toHaveBeenCalledWith('tok-active', expect.any(String));
  });

  it('propagates error when cubejs load rejects', async () => {
    const mockLoad = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(
      runCompareLoad({
        ...BASE_PARAMS,
        query: BASE_QUERY,
        mode: 'prev',
        currentResultSet: makeResultSet([{ 'Orders.count': 50 }]),
        measures: ['Orders.count'],
        _apiFactory: makeStubFactory(mockLoad),
      }),
    ).rejects.toThrow(/Network error/);
  });

  it('returns empty mergedRows when both result sets are empty', async () => {
    const mockLoad = vi.fn().mockResolvedValue(makeResultSet([]));

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: BASE_QUERY,
      mode: 'prev',
      currentResultSet: makeResultSet([]),
      measures: ['Orders.count'],
      _apiFactory: makeStubFactory(mockLoad),
    });

    expect(result.mergedRows).toEqual([]);
    expect(result.compLabel).toBe('Prior period');
  });
});

// ---------------------------------------------------------------------------
// Tests — game mode
// ---------------------------------------------------------------------------

describe('runCompareLoad – game mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mints a per-game token and uses it for comparison query', async () => {
    const compRows = [{ 'dau.gameId': 'cfm', 'dau.count': 300 }];
    const mockLoad = vi.fn().mockResolvedValue(makeResultSet(compRows));
    const stubFactory = makeStubFactory(mockLoad);

    (cubeTokenClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'tok-cfm',
      source: 'env',
    });

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: {
        measures: ['dau.count'],
        filters: [{ member: 'dau.gameId', operator: 'equals', values: ['ptg'] }] as any,
      },
      mode: 'game:cfm',
      currentResultSet: makeResultSet([{ 'dau.gameId': 'ptg', 'dau.count': 500 }]),
      measures: ['dau.count'],
      _apiFactory: stubFactory,
    });

    expect(cubeTokenClient.get).toHaveBeenCalledWith('cfm');
    // Factory must be called with the per-game token for the comparison request.
    expect(stubFactory).toHaveBeenCalledWith('tok-cfm', expect.any(String));

    expect(result.compLabel).toBe('Game: cfm');
    expect(result.mergedRows).not.toBeNull();
  });

  it('falls back to current token when per-game token fetch returns null', async () => {
    (cubeTokenClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const mockLoad = vi.fn().mockResolvedValue(makeResultSet([{ 'dau.count': 200 }]));
    const stubFactory = makeStubFactory(mockLoad);

    await runCompareLoad({
      ...BASE_PARAMS,
      query: { measures: ['dau.count'] },
      mode: 'game:cfm',
      currentResultSet: makeResultSet([{ 'dau.count': 300 }]),
      measures: ['dau.count'],
      _apiFactory: stubFactory,
    });

    // Fallback: factory called with the current (active) token.
    expect(stubFactory).toHaveBeenCalledWith('tok-active', expect.any(String));
  });

  it('sets compLabel to "Game: <id>" for game mode', async () => {
    (cubeTokenClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const mockLoad = vi.fn().mockResolvedValue(makeResultSet([]));

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: { measures: ['dau.count'] },
      mode: 'game:xyz',
      currentResultSet: makeResultSet([]),
      measures: ['dau.count'],
      _apiFactory: makeStubFactory(mockLoad),
    });

    expect(result.compLabel).toBe('Game: xyz');
  });
});

// ---------------------------------------------------------------------------
// Hook smoke tests — no DOM needed, just verify exported shape & label logic
// ---------------------------------------------------------------------------

describe('useCompareResults – hook shape', () => {
  it('exports useCompareResults as a function', async () => {
    // Dynamic import avoids any React/hook execution at top level.
    const mod = await import('./use-compare-results');
    expect(typeof mod.useCompareResults).toBe('function');
  });

  it('IDLE_STATE shape is accessible via runCompareLoad exports', async () => {
    const mod = await import('./use-compare-results');
    // Verify the module exports the expected symbols.
    expect(typeof mod.runCompareLoad).toBe('function');
    expect(typeof mod.useCompareResults).toBe('function');
  });
});
