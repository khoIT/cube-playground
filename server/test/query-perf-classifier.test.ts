/**
 * Pure-classifier tests: identifier-dim → unmatchable+miss (the verified root
 * cause), additive+rollup+fast → lambda-unknown (never a false miss),
 * non-additive → partial, time-dim mismatch → matchable+reason.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyQueryPerf,
  matchability,
  isIdentifierDim,
  isNonAdditiveMeasure,
  dominantCube,
  type RegistryView,
} from '../src/services/query-perf-classifier.js';

const NO_ROLLUPS: RegistryView = {};
const WITH_ROLLUP: RegistryView = {
  active_daily: { hasRollup: true, timeDimensions: ['active_daily.log_date'] },
};

describe('helpers', () => {
  it('isIdentifierDim catches per-entity ids', () => {
    expect(isIdentifierDim('mf_users.user_id')).toBe(true);
    expect(isIdentifierDim('recharge.transid')).toBe(true);
    expect(isIdentifierDim('mf_users.country')).toBe(false);
    expect(isIdentifierDim('active_daily.log_date')).toBe(false);
  });
  it('isNonAdditiveMeasure flags avg + exact distinct, allows approx', () => {
    expect(isNonAdditiveMeasure('x.avg_session')).toBe(true);
    expect(isNonAdditiveMeasure('x.count_distinct_users')).toBe(true);
    expect(isNonAdditiveMeasure('x.count_distinct_approx_users')).toBe(false);
    expect(isNonAdditiveMeasure('x.dau')).toBe(false);
    expect(isNonAdditiveMeasure('x.revenue_sum')).toBe(false);
  });
  it('dominantCube picks the most-referenced cube', () => {
    expect(dominantCube({ cubes: [], measures: ['a.x', 'a.y'], dimensions: ['b.z'] })).toBe('a');
  });
});

describe('matchability', () => {
  it('per-user row listing → unmatchable', () => {
    const v = matchability({ cubes: ['mf_users'], measures: [], dimensions: ['mf_users.user_id'] }, NO_ROLLUPS);
    expect(v.matchability).toBe('unmatchable');
    expect(v.reason).toContain('user_id');
  });
  it('non-additive measure → partial', () => {
    const v = matchability({ cubes: ['x'], measures: ['x.avg_ltv'], dimensions: ['x.country'] }, NO_ROLLUPS);
    expect(v.matchability).toBe('partial');
  });
  it('additive + no rollup → matchable (could add one)', () => {
    const v = matchability({ cubes: ['x'], measures: ['x.dau'], dimensions: ['x.country'] }, NO_ROLLUPS);
    expect(v.matchability).toBe('matchable');
    expect(v.reason).toContain('no rollup defined');
  });
  it('rollup exists but query binds a different time dim → time-dim mismatch', () => {
    const v = matchability(
      { cubes: ['active_daily'], measures: ['active_daily.dau'], dimensions: ['active_daily.dteventtime'] },
      WITH_ROLLUP,
    );
    expect(v.matchability).toBe('matchable');
    expect(v.reason).toContain('time-dim mismatch');
  });
});

describe('classifyQueryPerf (full verdict)', () => {
  it('root-cause: mf_users.user_id + date → unmatchable + miss', () => {
    const verdict = classifyQueryPerf(
      { cubes: ['mf_users'], measures: ['mf_users.count'], dimensions: ['mf_users.user_id', 'mf_users.last_active_date'] },
      [], 30500, NO_ROLLUPS,
    );
    expect(verdict.matchability).toBe('unmatchable');
    expect(verdict.preaggHit).toBe('miss');
    expect(verdict.reason).toContain('user_id');
  });

  it('used pre-aggs present → hit regardless of latency', () => {
    const verdict = classifyQueryPerf(
      { cubes: ['active_daily'], measures: ['active_daily.dau'], dimensions: ['active_daily.log_date'] },
      ['active_daily.dau_batch'], 50, WITH_ROLLUP,
    );
    expect(verdict.preaggHit).toBe('hit');
  });

  it('empty array + rollup exists + fast → lambda-unknown (not a false miss)', () => {
    const verdict = classifyQueryPerf(
      { cubes: ['active_daily'], measures: ['active_daily.dau'], dimensions: ['active_daily.log_date'] },
      [], 200, WITH_ROLLUP,
    );
    expect(verdict.preaggHit).toBe('unknown');
    expect(verdict.reason).toContain('lambda');
  });

  it('matchable + rollup exists + slow → miss (fell through)', () => {
    const verdict = classifyQueryPerf(
      { cubes: ['active_daily'], measures: ['active_daily.dau'], dimensions: ['active_daily.log_date'] },
      [], 9000, WITH_ROLLUP,
    );
    expect(verdict.preaggHit).toBe('miss');
  });

  it('empty shape → unknown, no crash', () => {
    const verdict = classifyQueryPerf({ cubes: [], measures: [], dimensions: [] }, [], 100, NO_ROLLUPS);
    expect(verdict.preaggHit).toBe('unknown');
  });
});
