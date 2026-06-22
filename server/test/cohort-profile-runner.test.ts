/**
 * Unit tests for the cohort-profile runner.
 *
 * All external I/O (Cube /load, identity resolution, percentile cutoffs) is
 * injected via the `deps` seam so these tests are pure — no real Cube or Trino.
 *
 * Coverage:
 *   - dimension selection from registry (per-game, empty-game degradation)
 *   - pct arithmetic: per-dimension pct values sum ≤ 100 (±rounding)
 *   - a failing dimension is omitted; surviving dims remain intact
 *   - timeout / throw from loadFn → graceful { total: null, breakdowns: [] }
 *   - identity-resolution failure → graceful empty
 *   - explicit `dimensions` override is respected
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runCohortProfile,
  selectProfileDimensions,
} from '../src/services/cohort-profile-runner.js';
import type { PredicateNode } from '../src/types/predicate-tree.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const simplePredicate: PredicateNode = {
  kind: 'group',
  id: 'g1',
  op: 'AND',
  children: [
    {
      kind: 'leaf',
      id: 'l1',
      member: 'mf_users.payer_tier',
      type: 'string',
      op: 'equals',
      values: ['whale'],
    },
  ],
};

const identityOk = vi.fn(async () => ({
  field: 'mf_users.user_id',
  reason: null as null,
}));

/** Build a minimal Cube grouped-response with n rows for a dimension. */
function makeGroupedResponse(
  dimensionMember: string,
  rows: Array<{ value: string; count: number }>,
) {
  const cubeName = dimensionMember.split('.')[0];
  const countKey = `${cubeName}.count`;
  return {
    data: rows.map((r) => ({ [dimensionMember]: r.value, [countKey]: String(r.count) })),
  };
}

// ---------------------------------------------------------------------------
// selectProfileDimensions
// ---------------------------------------------------------------------------

describe('selectProfileDimensions', () => {
  it('returns up to 4 preferred dims for a known game (cfm_vn)', () => {
    const dims = selectProfileDimensions('cfm_vn');
    expect(dims.length).toBeGreaterThan(0);
    expect(dims.length).toBeLessThanOrEqual(4);
    // Each entry should be a dotted Cube member name
    dims.forEach((d) => expect(d).toMatch(/\w+\.\w+/));
  });

  it('returns dims including country and payer_tier for cfm_vn', () => {
    const dims = selectProfileDimensions('cfm_vn');
    expect(dims.some((d) => d.endsWith('.country'))).toBe(true);
    expect(dims.some((d) => d.endsWith('.payer_tier'))).toBe(true);
  });

  it('returns [] for an unknown game (graceful degradation)', () => {
    expect(selectProfileDimensions('nonexistent_game')).toEqual([]);
  });

  it('returns [] for null / undefined game', () => {
    expect(selectProfileDimensions(null)).toEqual([]);
    expect(selectProfileDimensions(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runCohortProfile — happy path
// ---------------------------------------------------------------------------

describe('runCohortProfile', () => {
  it('returns total and breakdowns for a successful run', async () => {
    const dims = ['user_profile.country', 'user_profile.payer_tier'];

    // Total query returns 1000; each dim query returns 3 rows.
    let callCount = 0;
    const loadFn = vi.fn(async (query: unknown) => {
      callCount++;
      const q = query as Record<string, unknown>;
      if (q.total) {
        // Total query
        return { total: 1000 };
      }
      // Group-by query — respond based on which dimension was requested
      const dim = (q.dimensions as string[])[0];
      if (dim === 'user_profile.country') {
        return makeGroupedResponse(dim, [
          { value: 'VN', count: 600 },
          { value: 'TH', count: 300 },
          { value: 'ID', count: 100 },
        ]);
      }
      return makeGroupedResponse(dim, [
        { value: 'whale', count: 400 },
        { value: 'dolphin', count: 350 },
        { value: 'minnow', count: 250 },
      ]);
    });

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'mf_users', predicate: simplePredicate, dimensions: dims },
      { loadFn, resolveIdentity: identityOk as never },
    );

    expect(result.total).toBe(1000);
    expect(result.approx).toBe(false);
    expect(result.breakdowns).toHaveLength(2);
    expect(result.took_ms).toBeGreaterThanOrEqual(0);
  });

  it('pct values sum ≤ 100 per dimension (±0.5 for rounding)', async () => {
    const dims = ['user_profile.country'];
    const loadFn = vi.fn(async (query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.total) return { total: 1000 };
      return makeGroupedResponse('user_profile.country', [
        { value: 'VN', count: 500 },
        { value: 'TH', count: 300 },
        { value: 'ID', count: 150 },
        { value: 'MY', count: 30 },
        { value: 'SG', count: 15 },
        { value: 'PH', count: 5 },
      ]);
    });

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'mf_users', predicate: simplePredicate, dimensions: dims },
      { loadFn, resolveIdentity: identityOk as never },
    );

    const bd = result.breakdowns[0];
    expect(bd).toBeDefined();
    const sumPct = bd.top.reduce((s, r) => s + r.pct, 0);
    // top-6 counts sum to exactly 1000 = total, so pct sum = 100 (±rounding)
    expect(sumPct).toBeLessThanOrEqual(100.5);
    expect(sumPct).toBeGreaterThan(0);
  });

  it('pct is relative to grand total, not just top-k slice', async () => {
    const dims = ['user_profile.country'];
    // total = 2000 but top-k rows only cover 1000 → sum pct ≈ 50
    const loadFn = vi.fn(async (query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.total) return { total: 2000 };
      return makeGroupedResponse('user_profile.country', [
        { value: 'VN', count: 600 },
        { value: 'TH', count: 400 },
      ]);
    });

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'mf_users', predicate: simplePredicate, dimensions: dims },
      { loadFn, resolveIdentity: identityOk as never },
    );

    const bd = result.breakdowns[0];
    const sumPct = bd.top.reduce((s, r) => s + r.pct, 0);
    // 1000 / 2000 = 50%
    expect(sumPct).toBeCloseTo(50, 0);
  });

  // ---------------------------------------------------------------------------
  // Failure resilience
  // ---------------------------------------------------------------------------

  it('omits a failing dimension but returns surviving ones', async () => {
    const dims = ['user_profile.country', 'user_profile.payer_tier'];
    let call = 0;
    const loadFn = vi.fn(async (query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.total) return { total: 500 };
      call++;
      if (call === 1) {
        // first dim query fails
        throw new Error('Cube timeout');
      }
      // second dim query succeeds
      return makeGroupedResponse('user_profile.payer_tier', [
        { value: 'whale', count: 200 },
        { value: 'dolphin', count: 300 },
      ]);
    });

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'mf_users', predicate: simplePredicate, dimensions: dims },
      { loadFn, resolveIdentity: identityOk as never },
    );

    // One dim failed, one survived → exactly 1 breakdown
    expect(result.breakdowns).toHaveLength(1);
    expect(result.breakdowns[0].dimension).toBe('user_profile.payer_tier');
    // Total is still known
    expect(result.total).toBe(500);
  });

  it('returns { total: null, breakdowns: [] } when loadFn always throws', async () => {
    const loadFn = vi.fn(async () => {
      throw new Error('Cube unreachable');
    });

    const result = await runCohortProfile(
      {
        game_id: 'cfm_vn',
        cube: 'mf_users',
        predicate: simplePredicate,
        dimensions: ['user_profile.country'],
      },
      { loadFn, resolveIdentity: identityOk as never },
    );

    expect(result.total).toBeNull();
    expect(result.breakdowns).toEqual([]);
    expect(result.approx).toBe(true);
    expect(result.took_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns graceful empty when identity resolution fails', async () => {
    const loadFn = vi.fn(async () => ({ total: 100 }));
    const resolveIdentity = vi.fn(async () => {
      throw new Error('introspection error');
    });

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'bad_cube', predicate: simplePredicate },
      { loadFn, resolveIdentity: resolveIdentity as never },
    );

    expect(result.total).toBeNull();
    expect(result.breakdowns).toEqual([]);
    expect(result.approx).toBe(true);
    expect(loadFn).not.toHaveBeenCalled();
  });

  it('returns graceful empty when identity field is null (unknown cube)', async () => {
    const loadFn = vi.fn(async () => ({ total: 100 }));
    const resolveIdentity = vi.fn(async () => ({ field: null, reason: 'no-uid-dim' as const }));

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'unknown_cube', predicate: simplePredicate },
      { loadFn, resolveIdentity: resolveIdentity as never },
    );

    expect(result.total).toBeNull();
    expect(result.breakdowns).toEqual([]);
    expect(result.approx).toBe(true);
  });

  it('total-count failure → approx:true but breakdowns still assembled with relative pct', async () => {
    const dims = ['user_profile.country'];
    let call = 0;
    const loadFn = vi.fn(async (query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.total) throw new Error('total query failed');
      call++;
      return makeGroupedResponse('user_profile.country', [
        { value: 'VN', count: 700 },
        { value: 'TH', count: 300 },
      ]);
    });

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'mf_users', predicate: simplePredicate, dimensions: dims },
      { loadFn, resolveIdentity: identityOk as never },
    );

    expect(result.total).toBeNull();
    expect(result.approx).toBe(true);
    // Breakdowns are still present (relativized within top-k)
    expect(result.breakdowns).toHaveLength(1);
    const bd = result.breakdowns[0];
    const sumPct = bd.top.reduce((s, r) => s + r.pct, 0);
    // 700+300 = 1000 = denominator → sum = 100
    expect(sumPct).toBeCloseTo(100, 0);
  });

  it('uses game-default dimensions when none are explicitly provided', async () => {
    const loadFn = vi.fn(async (query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.total) return { total: 100 };
      // Echo back whatever dimension was queried with empty data
      return { data: [] };
    });

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'mf_users', predicate: simplePredicate },
      { loadFn, resolveIdentity: identityOk as never },
    );

    // Should have attempted breakdown queries (country, os_platform, etc.)
    // Total query + per-dim queries
    expect(loadFn).toHaveBeenCalledTimes(
      1 + selectProfileDimensions('cfm_vn').length,
    );
    expect(result.breakdowns.length).toBeGreaterThanOrEqual(0);
  });

  it('returns total-only (no breakdowns) when game has no profile panel', async () => {
    const loadFn = vi.fn(async (query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.total) return { total: 42 };
      return { data: [] };
    });

    const result = await runCohortProfile(
      { game_id: 'nonexistent_game', cube: 'some_cube', predicate: simplePredicate },
      { loadFn, resolveIdentity: identityOk as never },
    );

    // No profile panel → no default dims → no breakdown queries
    expect(result.total).toBe(42);
    expect(result.breakdowns).toEqual([]);
    // approx is false because total succeeded
    expect(result.approx).toBe(false);
    // Only the total query was issued
    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  it('caps to MAX_DIMS (4) even when more are explicitly provided', async () => {
    const manyDims = [
      'user_profile.country',
      'user_profile.os_platform',
      'user_profile.payer_tier',
      'user_profile.lifecycle_stage',
      'user_profile.media_source', // 5th — should be dropped
    ];
    const loadFn = vi.fn(async (query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.total) return { total: 100 };
      const dim = (q.dimensions as string[])[0];
      return makeGroupedResponse(dim, [{ value: 'x', count: 50 }]);
    });

    const result = await runCohortProfile(
      { game_id: 'cfm_vn', cube: 'mf_users', predicate: simplePredicate, dimensions: manyDims },
      { loadFn, resolveIdentity: identityOk as never },
    );

    expect(result.breakdowns.length).toBeLessThanOrEqual(4);
    // total (1) + up to 4 dim queries = 5 calls max
    expect(loadFn.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
