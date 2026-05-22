/**
 * Tests for bucketDateRange — turns a bucketed time value into an inclusive
 * [start, end] date range usable as a Cube inDateRange filter.
 */

import { describe, it, expect } from 'vitest';
import { bucketDateRange } from '../bucket-range';

describe('bucketDateRange', () => {
  it('day → single-day range', () => {
    expect(bucketDateRange('2026-05-04', 'day')).toEqual(['2026-05-04', '2026-05-04']);
  });

  it('week → 7-day inclusive range', () => {
    expect(bucketDateRange('2026-05-04', 'week')).toEqual(['2026-05-04', '2026-05-10']);
  });

  it('month → 1st through last day of that month', () => {
    expect(bucketDateRange('2026-03-01', 'month')).toEqual(['2026-03-01', '2026-03-31']);
    expect(bucketDateRange('2026-02-01', 'month')).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('quarter → 3-month inclusive range', () => {
    expect(bucketDateRange('2026-01-01', 'quarter')).toEqual(['2026-01-01', '2026-03-31']);
  });

  it('year → full-year inclusive range', () => {
    expect(bucketDateRange('2026-01-01', 'year')).toEqual(['2026-01-01', '2026-12-31']);
  });

  it('accepts ISO timestamp inputs', () => {
    expect(bucketDateRange('2026-05-04T00:00:00.000Z', 'week')).toEqual([
      '2026-05-04',
      '2026-05-10',
    ]);
  });

  it('returns null for nullish/invalid inputs', () => {
    expect(bucketDateRange(null, 'week')).toBeNull();
    expect(bucketDateRange(undefined, 'week')).toBeNull();
    expect(bucketDateRange('not-a-date', 'week')).toBeNull();
  });

  it('unknown granularity falls back to a single-point range', () => {
    expect(bucketDateRange('2026-05-04', undefined)).toEqual(['2026-05-04', '2026-05-04']);
    expect(bucketDateRange('2026-05-04', 'unknown' as any)).toEqual([
      '2026-05-04',
      '2026-05-04',
    ]);
  });
});
