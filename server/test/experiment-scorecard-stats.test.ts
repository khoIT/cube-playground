/**
 * Scorecard stats — the two-proportion z-test, mean difference, and verdict
 * logic, checked against hand-computed fixtures.
 */

import { describe, it, expect } from 'vitest';
import {
  twoProportionTest,
  meanDifference,
  computeScorecard,
} from '../src/experiments/scorecard-stats.js';
import type { ArmOutcome } from '../src/experiments/experiment-types.js';

describe('twoProportionTest', () => {
  it('large clear lift is significant (p≈0)', () => {
    // 25% vs 15% over 1000 each → z≈5.6.
    const r = twoProportionTest(250, 1000, 150, 1000);
    expect(r.liftPp).toBeCloseTo(10, 5);
    expect(r.treatmentRate).toBeCloseTo(0.25, 5);
    expect(r.controlRate).toBeCloseTo(0.15, 5);
    expect(r.pValue).toBeLessThan(0.001);
    expect(r.significant).toBe(true);
    // CI on the pp difference brackets the point estimate and excludes 0.
    expect(r.ci95[0]).toBeGreaterThan(0);
    expect(r.ci95[0]).toBeLessThan(10);
    expect(r.ci95[1]).toBeGreaterThan(10);
  });

  it('small lift on small n is not significant', () => {
    // 22% vs 13% over 100 each → z≈1.67, p≈0.09.
    const r = twoProportionTest(22, 100, 13, 100);
    expect(r.liftPp).toBeCloseTo(9, 5);
    expect(r.pValue).toBeGreaterThan(0.05);
    expect(r.significant).toBe(false);
  });

  it('zero denominators do not throw', () => {
    const r = twoProportionTest(0, 0, 0, 0);
    expect(r.liftPp).toBe(0);
    expect(r.significant).toBe(false);
  });
});

describe('meanDifference', () => {
  it('computes per-member mean lift and relative lift', () => {
    const m = meanDifference(1_000_000, 100, 500_000, 100);
    expect(m.treatmentMean).toBe(10_000);
    expect(m.controlMean).toBe(5_000);
    expect(m.liftAbs).toBe(5_000);
    expect(m.liftPct).toBeCloseTo(1.0, 5);
  });

  it('null relative lift when control mean is 0', () => {
    expect(meanDifference(1000, 10, 0, 10).liftPct).toBeNull();
  });
});

describe('computeScorecard verdict', () => {
  const arm = (a: 'treatment' | 'control', payers: number, assigned: number, gross: number): ArmOutcome => ({
    arm: a,
    assigned,
    payers,
    grossVnd: gross,
    txns: payers,
  });

  it('win: positive + significant', () => {
    const sc = computeScorecard([arm('treatment', 250, 1000, 5e6), arm('control', 150, 1000, 3e6)]);
    expect(sc.verdict).toBe('win');
  });

  it('inconclusive: positive but not significant', () => {
    const sc = computeScorecard([arm('treatment', 22, 100, 5e5), arm('control', 13, 100, 3e5)]);
    expect(sc.verdict).toBe('inconclusive');
  });

  it('flat: no positive lift', () => {
    const sc = computeScorecard([arm('treatment', 100, 1000, 1e6), arm('control', 150, 1000, 1.5e6)]);
    expect(sc.verdict).toBe('flat');
  });
});
