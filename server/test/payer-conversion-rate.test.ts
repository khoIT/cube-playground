/**
 * Payer factor as a conversion RATE, not a raw count.
 *
 * A sub-segment always has fewer payers than the whole game (a slice is smaller
 * than the whole), so comparing raw payer COUNTS flagged every cohort "weak" by
 * construction — even a cohort that converts better than the population. The
 * revenue goal tree now compares payers ÷ users (an intensive rate) when a
 * `users` denominator is supplied, and only then.
 *
 * These cases pin the behaviour: the rate fix must (a) NOT flag a smaller cohort
 * that converts better, (b) still flag a cohort that genuinely converts worse,
 * and (c) degrade to the count comparison when no denominator is present.
 */

import { describe, it, expect } from 'vitest';
import { buildRevenueGoalTree } from '../src/advisor/goal-tree.js';

function payerFactor(tree: ReturnType<typeof buildRevenueGoalTree>) {
  return tree.factors.find((f) => f.key === 'payers')!;
}

describe('payers factor — conversion rate vs count', () => {
  it('does NOT flag a smaller cohort that converts BETTER than the population', () => {
    // 40k payers out of 42k users (≈98% — a dolphin cohort, nearly all pay) vs a
    // population of 238k payers out of 5M users (≈4.8%). The count is far smaller
    // but the conversion rate is far higher → must not be weak.
    const tree = buildRevenueGoalTree(
      { payers: 40_000, users: 42_000, arppu: 500_000, lifespan: 120 },
      { payers: 238_000, users: 5_000_000, arppu: 500_000, lifespan: 120 },
    );
    const f = payerFactor(tree);
    expect(f.label).toBe('Payer Conversion');
    expect(f.unit).toBe('rate');
    expect(f.weak).toBe(false);
  });

  it('still flags a cohort that genuinely converts WORSE than the population', () => {
    // 1k payers out of 100k users (1%) vs population 4.8% → below 80% of baseline.
    const tree = buildRevenueGoalTree(
      { payers: 1_000, users: 100_000, arppu: 500_000, lifespan: 120 },
      { payers: 238_000, users: 5_000_000, arppu: 500_000, lifespan: 120 },
    );
    expect(payerFactor(tree).weak).toBe(true);
  });

  it('falls back to the raw count comparison when no denominator is supplied', () => {
    // Legacy inputs (no `users`): a smaller count is still read as weak.
    const tree = buildRevenueGoalTree(
      { payers: 40_000, arppu: 500_000, lifespan: 120 },
      { payers: 238_000, arppu: 500_000, lifespan: 120 },
    );
    const f = payerFactor(tree);
    expect(f.label).toBe('Payer Count');
    expect(f.unit).toBe('users');
    expect(f.weak).toBe(true); // 40k / 238k = 17% < 80% threshold
  });

  it('falls back to the count when a denominator is zero (no divide-by-zero)', () => {
    const tree = buildRevenueGoalTree(
      { payers: 0, users: 0, arppu: null, lifespan: 120 },
      { payers: 238_000, users: 5_000_000, arppu: 500_000, lifespan: 120 },
    );
    const f = payerFactor(tree);
    expect(f.label).toBe('Payer Count');
  });
});
