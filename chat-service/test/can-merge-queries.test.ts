/**
 * Tests for canMerge — the static guard deciding whether two Cube queries can
 * be overlaid on one date axis. This is the correctness boundary: only same
 * grain + same window + disjoint measures + exactly one dated time dim merges.
 */

import { describe, it, expect } from 'vitest';
import { canMerge } from '../src/tools/can-merge-queries.js';
import type { CubeQuery } from '../src/types.js';

const RANGE: [string, string] = ['2026-06-01', '2026-06-10'];

const primary: CubeQuery = {
  measures: ['active_daily.paying_dau'],
  timeDimensions: [{ dimension: 'active_daily.log_date', granularity: 'day', dateRange: RANGE }],
};
const overlay: CubeQuery = {
  measures: ['user_recharge_daily.revenue_vnd_total'],
  timeDimensions: [{ dimension: 'user_recharge_daily.log_date', granularity: 'day', dateRange: RANGE }],
};

describe('canMerge', () => {
  it('accepts same grain + window + disjoint measures', () => {
    expect(canMerge(primary, overlay)).toEqual({ ok: true });
  });

  it('rejects a granularity mismatch', () => {
    const o = { ...overlay, timeDimensions: [{ ...overlay.timeDimensions![0], granularity: 'week' as const }] };
    const r = canMerge(primary, o);
    expect(r).toMatchObject({ ok: false, reason: 'granularity_mismatch' });
  });

  it('rejects a date-window mismatch', () => {
    const o = {
      ...overlay,
      timeDimensions: [{ ...overlay.timeDimensions![0], dateRange: ['2026-05-01', '2026-05-10'] as [string, string] }],
    };
    expect(canMerge(primary, o)).toMatchObject({ ok: false, reason: 'range_mismatch' });
  });

  it('rejects identical/overlapping measures (nothing to contrast)', () => {
    const o = { ...overlay, measures: ['active_daily.paying_dau'] };
    expect(canMerge(primary, o)).toMatchObject({ ok: false, reason: 'measure_overlap' });
  });

  it('rejects a query with no dated time dimension', () => {
    const o = { ...overlay, timeDimensions: [] };
    expect(canMerge(primary, o)).toMatchObject({ ok: false, reason: 'no_time_dim' });
  });

  it('rejects a query with more than one dated time dimension', () => {
    const o: CubeQuery = {
      ...overlay,
      timeDimensions: [
        { dimension: 'user_recharge_daily.log_date', granularity: 'day', dateRange: RANGE },
        { dimension: 'user_recharge_daily.first_pay_date', granularity: 'day', dateRange: RANGE },
      ],
    };
    expect(canMerge(primary, o)).toMatchObject({ ok: false, reason: 'multiple_time_dims' });
  });

  it('rejects when a query has no measure', () => {
    const o = { ...overlay, measures: [] };
    expect(canMerge(primary, o)).toMatchObject({ ok: false, reason: 'no_measures' });
  });

  it('treats an equal relative phrase as a matching window', () => {
    const p = { ...primary, timeDimensions: [{ ...primary.timeDimensions![0], dateRange: 'last 7 days' }] };
    const o = { ...overlay, timeDimensions: [{ ...overlay.timeDimensions![0], dateRange: 'last 7 days' }] };
    expect(canMerge(p, o)).toEqual({ ok: true });
  });
});
