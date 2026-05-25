import { describe, it, expect } from 'vitest';
import { resolveDateRanges } from '../../src/nl-to-query/date-resolver.js';

const NOW = new Date('2026-05-25T00:00:00Z').getTime();

describe('date-resolver', () => {
  it('hôm qua → yesterday range', () => {
    const out = resolveDateRanges('doanh thu hôm qua', NOW);
    expect(out[0].dateRange).toEqual(['2026-05-24', '2026-05-24']);
  });

  it('3 tháng qua → 90-day window', () => {
    const out = resolveDateRanges('doanh thu 3 tháng qua', NOW);
    expect(out[0].dateRange).toEqual(['2026-02-25', '2026-05-25']);
    expect(out[0].granularity).toBe('month');
  });

  it('last 7 days → 7-day window', () => {
    const out = resolveDateRanges('show dau last 7 days', NOW);
    expect(out[0].dateRange).toEqual(['2026-05-19', '2026-05-25']);
  });

  it('Q1 2026 → first quarter', () => {
    const out = resolveDateRanges('revenue Q1 2026', NOW);
    expect(out[0].dateRange).toEqual(['2026-01-01', '2026-03-31']);
  });

  it('tháng 3 → march of current year', () => {
    const out = resolveDateRanges('mau tháng 3', NOW);
    expect(out[0].dateRange).toEqual(['2026-03-01', '2026-03-31']);
  });

  it('returns empty array on no matches', () => {
    const out = resolveDateRanges('hello world', NOW);
    expect(out).toEqual([]);
  });
});
