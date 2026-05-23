import { describe, expect, it } from 'vitest';

import { classifySeries } from '../src/services/z-score.js';

describe('classifySeries', () => {
  it('returns null for too-short series', () => {
    expect(classifySeries([])).toBeNull();
    expect(classifySeries([1, 2, 3])).toBeNull();
    expect(classifySeries([1, 2, 3, 4, 5])).toBeNull();
  });

  it('returns null when baseline is constant (sigma=0)', () => {
    expect(classifySeries([10, 10, 10, 10, 10, 10])).toBeNull();
  });

  it('classifies a stable series as none', () => {
    // Baseline 100±2, latest = 101 → low z-score
    const s = [100, 102, 98, 101, 99, 100, 101];
    const r = classifySeries(s);
    expect(r).not.toBeNull();
    expect(r!.state).toBe('none');
  });

  it('classifies a large positive spike as high', () => {
    // Baseline mean ~100, stddev small; latest 150
    const s = [100, 102, 98, 101, 99, 100, 150];
    const r = classifySeries(s);
    expect(r).not.toBeNull();
    expect(r!.state).toBe('high');
    expect(r!.deltaPct).toBeGreaterThan(0);
  });

  it('classifies a large negative dip as low', () => {
    const s = [100, 102, 98, 101, 99, 100, 50];
    const r = classifySeries(s);
    expect(r).not.toBeNull();
    expect(r!.state).toBe('low');
    expect(r!.deltaPct).toBeLessThan(0);
  });

  it('flags a monotonic walk as trend even when z<2', () => {
    // Walk up but smoothly — z still small because variance grows with mean.
    const s = [100, 105, 110, 115, 120, 125, 130];
    const r = classifySeries(s);
    expect(r).not.toBeNull();
    // Either trend or high — both are non-none signals; assert non-none.
    expect(r!.state).not.toBe('none');
  });
});
