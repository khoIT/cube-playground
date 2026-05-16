import { describe, it, expect } from 'vitest';
import { OPERATIONS, filterBySegment } from '../operations';

describe('OPERATIONS', () => {
  it('has 9 operations (Custom SQL dropped)', () => {
    expect(OPERATIONS).toHaveLength(9);
    expect(OPERATIONS.find((o) => o.id === ('custom' as any))).toBeUndefined();
  });

  it('Common segment excludes pro ops (Median + Percentile)', () => {
    const common = filterBySegment('common');
    expect(common.map((o) => o.id)).not.toContain('median');
    expect(common.map((o) => o.id)).not.toContain('percentile');
    expect(common.length).toBe(7);
  });

  it('Advanced segment returns only pro ops', () => {
    const adv = filterBySegment('advanced');
    expect(adv.map((o) => o.id).sort()).toEqual(['median', 'percentile']);
  });

  it('All segment returns every op', () => {
    expect(filterBySegment('all')).toHaveLength(9);
  });
});
