/**
 * Tests for the FE-side relative-dateRange normalizer.
 * Locked at 2026-05-26 to match the chat-service counterpart so any drift
 * between the two implementations surfaces as a failing assertion.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeRelativeDateRangeString,
  normalizeQueryRelativeDateRanges,
} from '../normalize-relative-date-range';

const NOW = new Date('2026-05-26T00:00:00Z');

describe('normalizeRelativeDateRangeString (FE)', () => {
  it('rewrites "last 3 months" to a rolling tuple', () => {
    expect(normalizeRelativeDateRangeString('last 3 months', NOW)).toEqual([
      '2026-02-26',
      '2026-05-25',
    ]);
  });

  it('rewrites "last 1 year" with full-year subtraction', () => {
    expect(normalizeRelativeDateRangeString('last 1 year', NOW)).toEqual([
      '2025-05-26',
      '2026-05-25',
    ]);
  });

  it('passes day-unit strings through (Cube already rolling)', () => {
    expect(normalizeRelativeDateRangeString('last 30 days', NOW)).toBe('last 30 days');
    expect(normalizeRelativeDateRangeString('today', NOW)).toBe('today');
  });

  it('passes malformed input through', () => {
    expect(normalizeRelativeDateRangeString('past 3 months', NOW)).toBe('past 3 months');
    expect(normalizeRelativeDateRangeString('', NOW)).toBe('');
  });
});

describe('normalizeQueryRelativeDateRanges (FE)', () => {
  it('rewrites only non-day relative strings in timeDimensions', () => {
    const input = {
      measures: ['x.m'],
      timeDimensions: [
        { dimension: 'x.t', granularity: 'week' as const, dateRange: 'last 3 months' },
        { dimension: 'x.t', granularity: 'day' as const, dateRange: 'last 30 days' },
        { dimension: 'x.t', granularity: 'day' as const, dateRange: ['2026-01-01', '2026-02-01'] as [string, string] },
      ],
    };
    const out = normalizeQueryRelativeDateRanges(input, NOW)!;
    expect(out.timeDimensions![0].dateRange).toEqual(['2026-02-26', '2026-05-25']);
    expect(out.timeDimensions![1].dateRange).toBe('last 30 days');
    expect(out.timeDimensions![2].dateRange).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('returns SAME query reference when nothing changed', () => {
    const input = {
      measures: ['x.m'],
      timeDimensions: [
        { dimension: 'x.t', granularity: 'day' as const, dateRange: 'last 7 days' },
      ],
    };
    expect(normalizeQueryRelativeDateRanges(input, NOW)).toBe(input);
  });

  it('passes null / undefined / no-timeDimensions through unchanged', () => {
    expect(normalizeQueryRelativeDateRanges(null, NOW)).toBeNull();
    expect(normalizeQueryRelativeDateRanges(undefined, NOW)).toBeUndefined();
    const noTd = { measures: ['x.m'] };
    expect(normalizeQueryRelativeDateRanges(noTd, NOW)).toBe(noTd);
  });

  it('does not mutate the input query', () => {
    const input = {
      measures: ['x.m'],
      timeDimensions: [
        { dimension: 'x.t', granularity: 'week' as const, dateRange: 'last 3 months' },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeQueryRelativeDateRanges(input, NOW);
    expect(input).toEqual(snapshot);
  });
});
