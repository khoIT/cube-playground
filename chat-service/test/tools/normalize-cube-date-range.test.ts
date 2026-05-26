/**
 * Tests for normalize-cube-date-range — the chat-side rewriter that converts
 * "last N week/month/quarter/year" strings to rolling [start, end] tuples
 * before they reach Cube. Locks the May 26, 2026 reference date matching
 * the parse-date-range test convention.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeRelativeDateRangeString,
  normalizeCubeDateRanges,
} from '../../src/tools/normalize-cube-date-range.js';

const NOW = new Date('2026-05-26T00:00:00Z');

describe('normalizeRelativeDateRangeString', () => {
  it('rewrites "last 3 months" to rolling [today − 3 months, yesterday]', () => {
    // Feb 26 → May 25 — current month included, today excluded.
    // Compare against Cube's calendar-aligned result for the same input
    // ([2026-02-01, 2026-04-30]), which is the surprising case this helper
    // sidesteps.
    expect(normalizeRelativeDateRangeString('last 3 months', NOW)).toEqual([
      '2026-02-26',
      '2026-05-25',
    ]);
  });

  it('rewrites "last 1 month" to a 1-calendar-month rolling window', () => {
    expect(normalizeRelativeDateRangeString('last 1 month', NOW)).toEqual([
      '2026-04-26',
      '2026-05-25',
    ]);
  });

  it('rewrites "last 6 months" with correct year rollover', () => {
    expect(normalizeRelativeDateRangeString('last 6 months', NOW)).toEqual([
      '2025-11-26',
      '2026-05-25',
    ]);
  });

  it('rewrites "last 2 weeks" to rolling 14 days ending yesterday', () => {
    expect(normalizeRelativeDateRangeString('last 2 weeks', NOW)).toEqual([
      '2026-05-12',
      '2026-05-25',
    ]);
  });

  it('rewrites "last 1 quarter" as 3 calendar months back', () => {
    expect(normalizeRelativeDateRangeString('last 1 quarter', NOW)).toEqual([
      '2026-02-26',
      '2026-05-25',
    ]);
  });

  it('rewrites "last 1 year" with full year subtraction', () => {
    expect(normalizeRelativeDateRangeString('last 1 year', NOW)).toEqual([
      '2025-05-26',
      '2026-05-25',
    ]);
  });

  it('passes "last 30 days" through unchanged (Cube already rolling)', () => {
    expect(normalizeRelativeDateRangeString('last 30 days', NOW)).toBe('last 30 days');
  });

  it('passes "last 1 day" through unchanged', () => {
    expect(normalizeRelativeDateRangeString('last 1 day', NOW)).toBe('last 1 day');
  });

  it('passes calendar keywords through unchanged', () => {
    expect(normalizeRelativeDateRangeString('today', NOW)).toBe('today');
    expect(normalizeRelativeDateRangeString('yesterday', NOW)).toBe('yesterday');
    expect(normalizeRelativeDateRangeString('this month', NOW)).toBe('this month');
    expect(normalizeRelativeDateRangeString('last month', NOW)).toBe('last month');
    expect(normalizeRelativeDateRangeString('this quarter', NOW)).toBe('this quarter');
  });

  it('passes malformed strings through unchanged', () => {
    expect(normalizeRelativeDateRangeString('last few months', NOW)).toBe('last few months');
    expect(normalizeRelativeDateRangeString('past 3 months', NOW)).toBe('past 3 months');
    expect(normalizeRelativeDateRangeString('', NOW)).toBe('');
  });

  it('is case-insensitive for the verb and unit', () => {
    expect(normalizeRelativeDateRangeString('LAST 3 MONTHS', NOW)).toEqual([
      '2026-02-26',
      '2026-05-25',
    ]);
  });

  it('tolerates surrounding whitespace', () => {
    expect(normalizeRelativeDateRangeString('  last 3 months  ', NOW)).toEqual([
      '2026-02-26',
      '2026-05-25',
    ]);
  });

  it('rejects qty=0 and negative qty (no match → passthrough)', () => {
    expect(normalizeRelativeDateRangeString('last 0 months', NOW)).toBe('last 0 months');
  });
});

describe('normalizeCubeDateRanges', () => {
  it('rewrites only timeDimensions with non-day relative strings', () => {
    const input = [
      { dimension: 'recharge.recharge_time', granularity: 'week' as const, dateRange: 'last 3 months' },
      { dimension: 'recharge.recharge_time', granularity: 'day' as const, dateRange: 'last 30 days' },
      { dimension: 'recharge.recharge_time', granularity: 'day' as const, dateRange: 'today' },
      { dimension: 'recharge.recharge_time', granularity: 'day' as const, dateRange: ['2026-01-01', '2026-02-01'] as [string, string] },
      { dimension: 'recharge.recharge_time' },
    ];
    const out = normalizeCubeDateRanges(input, NOW)!;
    expect(out[0].dateRange).toEqual(['2026-02-26', '2026-05-25']);
    expect(out[1].dateRange).toBe('last 30 days');
    expect(out[2].dateRange).toBe('today');
    expect(out[3].dateRange).toEqual(['2026-01-01', '2026-02-01']);
    expect(out[4].dateRange).toBeUndefined();
  });

  it('returns the SAME array reference when no entries change (no needless copy)', () => {
    const input = [
      { dimension: 'x.t', granularity: 'day' as const, dateRange: 'last 7 days' },
      { dimension: 'x.t', granularity: 'day' as const, dateRange: 'today' },
    ];
    const out = normalizeCubeDateRanges(input, NOW);
    expect(out).toBe(input);
  });

  it('passes undefined/empty arrays through unchanged', () => {
    expect(normalizeCubeDateRanges(undefined, NOW)).toBeUndefined();
    const empty: Array<{ dimension: string }> = [];
    expect(normalizeCubeDateRanges(empty, NOW)).toBe(empty);
  });

  it('does not mutate the input array', () => {
    const input = [
      { dimension: 'x.t', granularity: 'week' as const, dateRange: 'last 3 months' },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeCubeDateRanges(input, NOW);
    expect(input).toEqual(snapshot);
  });
});
