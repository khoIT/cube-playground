/**
 * Tests for preagg-run-merge: the 4-outcome taxonomy + cross-game over-warn.
 *
 * All four outcomes are exercised:
 *   sealed        — probe=built  + no failure
 *   stale_serving — probe=built  + failure present  (KEY signal)
 *   failed        — probe=error  + failure present
 *   unbuilt       — probe=unbuilt + no failure
 *
 * Cross-game over-warn: a rollup-level failure attributes to EVERY game that
 * has that cube in its probe — both games → stale_serving even though only one
 * game's partition actually failed.
 */

import { describe, it, expect } from 'vitest';
import { mergeSweep } from '../src/services/preagg-run-merge.js';
import type { PreaggReadiness } from '../src/services/preagg-readiness.js';
import type { ParsedFailure } from '../src/types/preagg-run.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const META = {
  source: 'scheduled' as const,
  startedAt: '2026-06-10T07:00:00.000Z',
  endedAt: '2026-06-10T07:06:00.000Z',
  collectorStatus: 'online',
};

function makeProbe(games: PreaggReadiness['games']): PreaggReadiness {
  return { games, generatedAt: '2026-06-10T07:06:00.000Z' };
}

function makeFailure(cubeAndRollup: string, sig = 'etimedout'): ParsedFailure {
  return {
    preAggregationId: cubeAndRollup,
    errorSig: sig,
    errorMessage: `connect ETIMEDOUT — ${cubeAndRollup}`,
    ts: '2026-06-10T07:01:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Single-game, single-cube scenarios
// ---------------------------------------------------------------------------

describe('mergeSweep — outcome taxonomy', () => {
  it('sealed: probe=built + no failure', () => {
    const probe = makeProbe([{
      id: 'cfm_vn', label: 'CFM VN',
      cubes: [{ cube: 'active_daily', status: 'built' }],
      built: 1, unbuilt: 0, errored: 0,
    }]);

    const { items } = mergeSweep(probe, [], META);
    expect(items).toHaveLength(1);
    expect(items[0].outcome).toBe('sealed');
    expect(items[0].serveable).toBe(true);
    expect(items[0].errorSig).toBeNull();
  });

  it('stale_serving: probe=built + failure for that cube', () => {
    const probe = makeProbe([{
      id: 'cfm_vn', label: 'CFM VN',
      cubes: [{ cube: 'active_daily', status: 'built' }],
      built: 1, unbuilt: 0, errored: 0,
    }]);
    const failures = [makeFailure('active_daily.dau_by_ingame_dims_daily_batch')];

    const { items } = mergeSweep(probe, failures, META);
    expect(items[0].outcome).toBe('stale_serving');
    expect(items[0].serveable).toBe(true);   // old cache still up
    expect(items[0].errorSig).toBe('etimedout');
  });

  it('failed: probe=error + failure for that cube', () => {
    const probe = makeProbe([{
      id: 'cfm_vn', label: 'CFM VN',
      cubes: [{ cube: 'ordered_funnel_canonical', status: 'error', message: 'cube not found' }],
      built: 0, unbuilt: 0, errored: 1,
    }]);
    const failures = [makeFailure('ordered_funnel_canonical.canonical_daily', 'table-not-found')];

    const { items } = mergeSweep(probe, failures, META);
    expect(items[0].outcome).toBe('failed');
    expect(items[0].serveable).toBe(false);
    expect(items[0].errorSig).toBe('table-not-found');
  });

  it('unbuilt: probe=unbuilt + no failure', () => {
    const probe = makeProbe([{
      id: 'jus_vn', label: 'JUS VN',
      cubes: [{ cube: 'mf_users', status: 'unbuilt', message: 'no partition' }],
      built: 0, unbuilt: 1, errored: 0,
    }]);

    const { items } = mergeSweep(probe, [], META);
    expect(items[0].outcome).toBe('unbuilt');
    expect(items[0].serveable).toBe(false);
    expect(items[0].errorSig).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Aggregate counts
// ---------------------------------------------------------------------------

describe('mergeSweep — counts', () => {
  it('computes correct aggregate counts across mixed outcomes', () => {
    const probe = makeProbe([{
      id: 'cfm_vn', label: 'CFM VN',
      cubes: [
        { cube: 'active_daily', status: 'built' },
        { cube: 'game_key_metrics', status: 'built' },
        { cube: 'mf_users', status: 'unbuilt' },
        { cube: 'ordered_funnel_canonical', status: 'error' },
      ],
      built: 2, unbuilt: 1, errored: 1,
    }]);
    const failures = [
      makeFailure('game_key_metrics.kpi_batch'),
      makeFailure('ordered_funnel_canonical.canonical_daily', 'table-not-found'),
    ];

    const { sweep } = mergeSweep(probe, failures, META);
    expect(sweep.sealedCount).toBe(1);   // active_daily
    expect(sweep.staleCount).toBe(1);    // game_key_metrics
    expect(sweep.failedCount).toBe(1);   // ordered_funnel_canonical
    expect(sweep.unbuiltCount).toBe(1);  // mf_users
  });

  it('rollupsTotal equals game × cube pairs', () => {
    const probe = makeProbe([
      {
        id: 'cfm_vn', label: 'CFM VN',
        cubes: [{ cube: 'active_daily', status: 'built' }, { cube: 'mf_users', status: 'built' }],
        built: 2, unbuilt: 0, errored: 0,
      },
      {
        id: 'jus_vn', label: 'JUS VN',
        cubes: [{ cube: 'active_daily', status: 'built' }],
        built: 1, unbuilt: 0, errored: 0,
      },
    ]);

    const { sweep } = mergeSweep(probe, [], META);
    expect(sweep.rollupsTotal).toBe(3); // 2 + 1
  });
});

// ---------------------------------------------------------------------------
// Cross-game over-warn
// ---------------------------------------------------------------------------

describe('mergeSweep — cross-game over-warn', () => {
  it('attributes a rollup-level failure to ALL games that have that cube', () => {
    // Two games, both with active_daily in their probe
    const probe = makeProbe([
      {
        id: 'cfm_vn', label: 'CFM VN',
        cubes: [{ cube: 'active_daily', status: 'built' }],
        built: 1, unbuilt: 0, errored: 0,
      },
      {
        id: 'jus_vn', label: 'JUS VN',
        cubes: [{ cube: 'active_daily', status: 'built' }],
        built: 1, unbuilt: 0, errored: 0,
      },
    ]);
    // One log failure — rollup level, no game context
    const failures = [makeFailure('active_daily.dau_batch')];

    const { items } = mergeSweep(probe, failures, META);

    // Both games should be stale_serving — over-warn is the safe direction
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.outcome === 'stale_serving')).toBe(true);
  });

  it('does NOT mark a cube as stale when a different cube failed', () => {
    const probe = makeProbe([{
      id: 'cfm_vn', label: 'CFM VN',
      cubes: [
        { cube: 'active_daily', status: 'built' },
        { cube: 'mf_users', status: 'built' },
      ],
      built: 2, unbuilt: 0, errored: 0,
    }]);
    const failures = [makeFailure('active_daily.dau_batch')];

    const { items } = mergeSweep(probe, failures, META);

    const activeDailyItem = items.find((i) => i.cube === 'active_daily');
    const mfUsersItem = items.find((i) => i.cube === 'mf_users');

    expect(activeDailyItem?.outcome).toBe('stale_serving');
    expect(mfUsersItem?.outcome).toBe('sealed');
  });
});

// ---------------------------------------------------------------------------
// Source + metadata pass-through
// ---------------------------------------------------------------------------

describe('mergeSweep — metadata', () => {
  it('sets source and collectorStatus from meta', () => {
    const probe = makeProbe([]);
    const { sweep } = mergeSweep(probe, [], {
      ...META,
      source: 'probe-snapshot',
      collectorStatus: 'degraded',
    });
    expect(sweep.source).toBe('probe-snapshot');
    expect(sweep.collectorStatus).toBe('degraded');
  });

  it('computes durationMs from startedAt/endedAt', () => {
    const probe = makeProbe([]);
    const { sweep } = mergeSweep(probe, [], META);
    // 07:00 → 07:06 = 360 000 ms
    expect(sweep.durationMs).toBe(360_000);
  });
});

// ---------------------------------------------------------------------------
// Build-stats attachment (schema short name → probe game id)
// ---------------------------------------------------------------------------

describe('mergeSweep — build stats', () => {
  it('attaches aggregated partitions/duration/rollups to the matching game × cube', () => {
    const probe = makeProbe([{
      id: 'cfm_vn', label: 'CFM VN',
      cubes: [
        { cube: 'active_daily', status: 'built' },
        { cube: 'mf_users', status: 'built' },
      ],
      built: 2, unbuilt: 0, errored: 0,
    }]);
    const builds = [
      { schemaGame: 'cfm', cube: 'active_daily', rollup: 'dau_daily_batch', durationMs: 8000, ts: '2026-06-10T07:01:00.000Z' },
      { schemaGame: 'cfm', cube: 'active_daily', rollup: 'dau_daily_batch', durationMs: 2000, ts: '2026-06-10T07:02:00.000Z' },
      { schemaGame: 'cfm', cube: 'active_daily', rollup: 'online_time_batch', durationMs: 500, ts: '2026-06-10T07:03:00.000Z' },
    ];

    const { items } = mergeSweep(probe, [], META, builds);
    const ad = items.find((i) => i.cube === 'active_daily');
    expect(ad).toMatchObject({ buildMs: 10_500, partitionsBuilt: 3 });
    expect(ad?.rollupsBuilt?.sort()).toEqual(['dau_daily_batch', 'online_time_batch']);

    // mf_users had no build lines → stats stay null (probe-sealed, nothing rebuilt)
    const mf = items.find((i) => i.cube === 'mf_users');
    expect(mf?.buildMs).toBeNull();
    expect(mf?.partitionsBuilt).toBeNull();
  });

  it('drops builds whose schema game matches no probe game id', () => {
    const probe = makeProbe([{
      id: 'ballistar', label: 'Ballistar',
      cubes: [{ cube: 'active_daily', status: 'built' }],
      built: 1, unbuilt: 0, errored: 0,
    }]);
    const builds = [
      { schemaGame: 'zzz', cube: 'active_daily', rollup: 'dau_daily_batch', durationMs: 100, ts: '2026-06-10T07:01:00.000Z' },
    ];
    const { items } = mergeSweep(probe, [], META, builds);
    expect(items[0].buildMs).toBeNull();
  });

  it('matches exact game ids without a suffix (schema ballistar → id ballistar)', () => {
    const probe = makeProbe([{
      id: 'ballistar', label: 'Ballistar',
      cubes: [{ cube: 'active_daily', status: 'built' }],
      built: 1, unbuilt: 0, errored: 0,
    }]);
    const builds = [
      { schemaGame: 'ballistar', cube: 'active_daily', rollup: 'dau_daily_batch', durationMs: 100, ts: '2026-06-10T07:01:00.000Z' },
    ];
    const { items } = mergeSweep(probe, [], META, builds);
    expect(items[0].partitionsBuilt).toBe(1);
  });
});
