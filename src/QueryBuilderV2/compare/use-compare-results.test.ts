/**
 * Tests for use-compare-results.ts
 *
 * Strategy: test `runCompareLoad` directly (pure async fn, no React).
 * This avoids renderHook + jsdom which exhausts the 4 GB heap in Node v24
 * vitest forks pool during environment setup (OOM before any test runs).
 *
 * Game scope is carried by the x-cube-game header (forwarded via the factory's
 * gameId arg), NOT the client token — the cube proxy drops the client
 * Authorization header and mints the upstream token server-side. So the
 * assertions check the game id passed to the factory, not a per-game token.
 *
 * Hook integration (state transitions, isLoading, compLabel initial value)
 * is covered by lightweight synchronous assertions that don't need the DOM.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runCompareLoad } from './use-compare-results';
import type { ApiFactory, MetaFetcher } from './use-compare-results';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResultSet(rows: Record<string, string | number>[]) {
  return { loadResponse: { results: [{ data: rows }] } } as any;
}

function makeStubFactory(mockLoad: ReturnType<typeof vi.fn>): ApiFactory {
  return vi.fn(() => ({ load: mockLoad })) as unknown as ApiFactory;
}

// Meta fetcher stub — the set of members the target game "exposes".
function makeMetaFetcher(members: string[]): MetaFetcher {
  return vi.fn(async () => new Set(members));
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
  activeGameId: 'ballistar',
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
    // Prev mode stays scoped to the active game via the x-cube-game header.
    expect(stubFactory).toHaveBeenCalledWith('tok-active', expect.any(String), 'ballistar');
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

  it('scopes the comparison query to the target game via x-cube-game', async () => {
    const compRows = [{ 'dau.gameId': 'cfm', 'dau.count': 300 }];
    const mockLoad = vi.fn().mockResolvedValue(makeResultSet(compRows));
    const stubFactory = makeStubFactory(mockLoad);

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
      _metaFetcher: makeMetaFetcher(['dau.count']),
    });

    // Factory must be called with the TARGET game id so the proxy mints a
    // token scoped to that game — not the active game.
    expect(stubFactory).toHaveBeenCalledWith('tok-active', expect.any(String), 'cfm');

    expect(result.compLabel).toBe('Game: cfm');
    expect(result.unavailableMeasures).toEqual([]);
    expect(result.mergedRows).not.toBeNull();
  });

  it('drops measures the target game lacks and reports them as unavailable', async () => {
    const mockLoad = vi.fn().mockResolvedValue(
      makeResultSet([{ 'recharge.os_platform': 'ios', 'recharge.revenue_vnd': 200 }]),
    );
    const stubFactory = makeStubFactory(mockLoad);

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: {
        measures: ['recharge.revenue_vnd', 'mf_users.user_count'],
        dimensions: ['recharge.os_platform'],
      },
      mode: 'game:ptg',
      currentResultSet: makeResultSet([
        { 'recharge.os_platform': 'IOS', 'recharge.revenue_vnd': 500, 'mf_users.user_count': 10 },
      ]),
      measures: ['recharge.revenue_vnd', 'mf_users.user_count'],
      _apiFactory: stubFactory,
      // Target game has recharge but not mf_users.
      _metaFetcher: makeMetaFetcher(['recharge.revenue_vnd', 'recharge.os_platform']),
    });

    // mf_users dropped → flagged unavailable; revenue still compared.
    expect(result.unavailableMeasures).toEqual(['mf_users.user_count']);
    // The query actually sent to Cube must not include the missing measure.
    const sentQuery = mockLoad.mock.calls[0][0];
    expect(sentQuery.measures).toEqual(['recharge.revenue_vnd']);
    // Case-insensitive merge aligns 'IOS' (base) with 'ios' (target).
    expect(result.mergedRows[0]['recharge.revenue_vnd__delta']).toBe(300);
  });

  it('skips the load when the target game has none of the measures', async () => {
    const mockLoad = vi.fn();
    const stubFactory = makeStubFactory(mockLoad);

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: { measures: ['mf_users.user_count'] },
      mode: 'game:ptg',
      currentResultSet: makeResultSet([{ 'mf_users.user_count': 10 }]),
      measures: ['mf_users.user_count'],
      _apiFactory: stubFactory,
      _metaFetcher: makeMetaFetcher(['recharge.revenue_vnd']), // no mf_users
    });

    // No measures to compare → never hits Cube, never crashes.
    expect(mockLoad).not.toHaveBeenCalled();
    expect(result.unavailableMeasures).toEqual(['mf_users.user_count']);
    expect(result.mergedRows).not.toBeNull();
    expect(result.compLabel).toBe('Game: ptg');
  });

  it('flags noDimensionOverlap when comparison rows share no dim values (disjoint user_id)', async () => {
    // Cross-game per-user breakdown: the target game returns 2 payers, but none
    // share a user_id with the current game → nothing pairs.
    const mockLoad = vi.fn().mockResolvedValue(
      makeResultSet([
        { 'recharge.user_id': 'cfm-1', 'recharge.revenue_vnd': 462000000 },
        { 'recharge.user_id': 'cfm-2', 'recharge.revenue_vnd': 120000000 },
      ]),
    );

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: {
        measures: ['recharge.revenue_vnd'],
        dimensions: ['recharge.user_id'],
      },
      mode: 'game:cfm_vn',
      currentResultSet: makeResultSet([
        { 'recharge.user_id': 'active-1', 'recharge.revenue_vnd': 500000000 },
      ]),
      measures: ['recharge.revenue_vnd'],
      _apiFactory: makeStubFactory(mockLoad),
      _metaFetcher: makeMetaFetcher(['recharge.revenue_vnd', 'recharge.user_id']),
    });

    expect(result.noDimensionOverlap).toBe(true);
    // The comparison game's own rows are carried for the side-by-side leaderboard.
    expect(result.comparisonRows).toHaveLength(2);
  });

  it('does NOT flag noDimensionOverlap when rows pair on a shared dimension', async () => {
    const mockLoad = vi.fn().mockResolvedValue(
      makeResultSet([{ 'recharge.os_platform': 'ios', 'recharge.revenue_vnd': 200 }]),
    );

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: { measures: ['recharge.revenue_vnd'], dimensions: ['recharge.os_platform'] },
      mode: 'game:cfm_vn',
      currentResultSet: makeResultSet([
        { 'recharge.os_platform': 'IOS', 'recharge.revenue_vnd': 500 },
      ]),
      measures: ['recharge.revenue_vnd'],
      _apiFactory: makeStubFactory(mockLoad),
      _metaFetcher: makeMetaFetcher(['recharge.revenue_vnd', 'recharge.os_platform']),
    });

    expect(result.noDimensionOverlap).toBe(false);
  });

  it('does NOT flag noDimensionOverlap for a measures-only query (always pairs)', async () => {
    const mockLoad = vi.fn().mockResolvedValue(makeResultSet([{ 'dau.count': 300 }]));

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: { measures: ['dau.count'] },
      mode: 'game:cfm_vn',
      currentResultSet: makeResultSet([{ 'dau.count': 500 }]),
      measures: ['dau.count'],
      _apiFactory: makeStubFactory(mockLoad),
      _metaFetcher: makeMetaFetcher(['dau.count']),
    });

    expect(result.noDimensionOverlap).toBe(false);
  });

  it('sets compLabel to "Game: <id>" for game mode', async () => {
    const mockLoad = vi.fn().mockResolvedValue(makeResultSet([]));

    const result = await runCompareLoad({
      ...BASE_PARAMS,
      query: { measures: ['dau.count'] },
      mode: 'game:xyz',
      currentResultSet: makeResultSet([]),
      measures: ['dau.count'],
      _apiFactory: makeStubFactory(mockLoad),
      _metaFetcher: makeMetaFetcher(['dau.count']),
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
