import { describe, it, expect } from 'vitest';
import { capSteps, type WaterfallStep } from '../contribution-waterfall';

const sum = (s: WaterfallStep[]) => s.reduce((t, x) => t + x.delta, 0);

describe('capSteps', () => {
  const many: WaterfallStep[] = Array.from({ length: 14 }, (_, i) => ({
    label: `seg_${i}`,
    delta: (i % 2 === 0 ? 1 : -1) * (i + 1) * 10,
  }));

  it('returns the steps untouched when within the cap', () => {
    const few = many.slice(0, 5);
    expect(capSteps(few, 8)).toBe(few);
  });

  it('folds the tail into a single Other step at the cap', () => {
    const capped = capSteps(many, 8);
    expect(capped).toHaveLength(8);
    const other = capped[capped.length - 1];
    expect(other.label).toBe(`Other (${many.length - 7})`);
  });

  it('preserves total Δ so the cumulative path still lands on period-B total', () => {
    const capped = capSteps(many, 8);
    expect(sum(capped)).toBeCloseTo(sum(many), 6);
  });

  it('keeps the biggest absolute movers, not the first-listed', () => {
    const capped = capSteps(many, 8);
    const heads = capped.slice(0, 7).map((s) => s.label);
    // seg_13 (±140) and seg_12 (±130) are the largest magnitudes — must survive.
    expect(heads).toContain('seg_13');
    expect(heads).toContain('seg_12');
  });
});
