import { describe, it, expect } from 'vitest';
import { OPERATIONS, filterBySegment } from '../operations';

describe('OPERATIONS', () => {
  it('has 11 operations (Custom SQL dropped; weightedAvg + formula added)', () => {
    expect(OPERATIONS).toHaveLength(11);
    expect(OPERATIONS.find((o) => o.id === ('custom' as any))).toBeUndefined();
  });

  it('Common segment excludes pro ops', () => {
    const common = filterBySegment('common');
    expect(common.map((o) => o.id)).not.toContain('median');
    expect(common.map((o) => o.id)).not.toContain('percentile');
    expect(common.map((o) => o.id)).not.toContain('weightedAvg');
    expect(common.map((o) => o.id)).not.toContain('formula');
    expect(common.length).toBe(7);
  });

  it('Advanced segment returns only pro ops', () => {
    const adv = filterBySegment('advanced');
    expect(adv.map((o) => o.id).sort()).toEqual(['formula', 'median', 'percentile', 'weightedAvg']);
  });

  it('All segment returns every op', () => {
    expect(filterBySegment('all')).toHaveLength(11);
  });
});
