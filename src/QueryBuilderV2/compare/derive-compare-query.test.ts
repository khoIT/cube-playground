/**
 * Tests for derive-compare-query.ts
 *
 * Covers every dateRange shape and the game-filter swap path.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  deriveCompareQuery,
  shiftNamedRange,
  shiftLiteralRange,
} from './derive-compare-query';
import type { Query } from '@cubejs-client/core';

// ---------------------------------------------------------------------------
// shiftLiteralRange
// ---------------------------------------------------------------------------

describe('shiftLiteralRange', () => {
  it('shifts a 7-day window by 7 days', () => {
    expect(shiftLiteralRange('2026-05-01', '2026-05-07')).toEqual([
      '2026-04-24',
      '2026-04-30',
    ]);
  });

  it('shifts a 30-day window correctly', () => {
    // window = 30 days, newTo = 2026-04-30, newFrom = 2026-04-01
    expect(shiftLiteralRange('2026-05-01', '2026-05-30')).toEqual([
      '2026-04-01',
      '2026-04-30',
    ]);
  });

  it('shifts a single-day window (today → yesterday)', () => {
    expect(shiftLiteralRange('2026-05-25', '2026-05-25')).toEqual([
      '2026-05-24',
      '2026-05-24',
    ]);
  });

  it('handles month-boundary crossing', () => {
    // 2026-03-01 to 2026-03-07 → shift back 7 days → 2026-02-22 to 2026-02-28
    expect(shiftLiteralRange('2026-03-01', '2026-03-07')).toEqual([
      '2026-02-22',
      '2026-02-28',
    ]);
  });
});

// ---------------------------------------------------------------------------
// shiftNamedRange
// ---------------------------------------------------------------------------

describe('shiftNamedRange', () => {
  it('"today" → "yesterday"', () => {
    expect(shiftNamedRange('today')).toBe('yesterday');
  });

  it('"yesterday" → null (no named prior-yesterday)', () => {
    expect(shiftNamedRange('yesterday')).toBeNull();
  });

  it('"this week" → "last week"', () => {
    expect(shiftNamedRange('this week')).toBe('last week');
  });

  it('"this month" → "last month"', () => {
    expect(shiftNamedRange('this month')).toBe('last month');
  });

  it('"this year" → "last year"', () => {
    expect(shiftNamedRange('this year')).toBe('last year');
  });

  it('"last week" → null (no double-prior named range)', () => {
    expect(shiftNamedRange('last week')).toBeNull();
  });

  it('"QTD" → null (unsupported)', () => {
    expect(shiftNamedRange('QTD')).toBeNull();
  });

  it('"last 7 days" → prior 7-day window as literal range string', () => {
    // Intercept no-arg Date() calls to return a fixed "today" value so the
    // window shift is deterministic regardless of when tests run.
    vi.useFakeTimers({ now: new Date('2026-05-25T00:00:00Z') });

    const result = shiftNamedRange('last 7 days');
    // today=2026-05-25, prior window ends 7 days before today = 2026-05-18
    // starts 14 days before today = 2026-05-11
    expect(result).toBe('2026-05-11 to 2026-05-18');

    vi.useRealTimers();
  });

  it('"last 30 days" → prior 30-day window', () => {
    vi.useFakeTimers({ now: new Date('2026-05-25T00:00:00Z') });

    const result = shiftNamedRange('last 30 days');
    // prior 30d ends 30 days before today = 2026-04-25
    // starts 60 days before today = 2026-03-26
    expect(result).toBe('2026-03-26 to 2026-04-25');

    vi.useRealTimers();
  });

  it('is case-insensitive', () => {
    expect(shiftNamedRange('Today')).toBe('yesterday');
    expect(shiftNamedRange('LAST 7 DAYS')).not.toBeNull(); // just needs to not throw
  });
});

// ---------------------------------------------------------------------------
// deriveCompareQuery — 'prev' mode
// ---------------------------------------------------------------------------

describe('deriveCompareQuery – prev mode', () => {
  it('returns null for null query', () => {
    expect(deriveCompareQuery(null, 'prev')).toBeNull();
  });

  it('returns null when no timeDimension and no inDateRange filter', () => {
    const q: Query = { measures: ['Orders.count'], dimensions: ['Orders.status'] };
    expect(deriveCompareQuery(q, 'prev')).toBeNull();
  });

  it('shifts a literal pair dateRange on timeDimension', () => {
    const q: Query = {
      measures: ['Orders.count'],
      timeDimensions: [
        { dimension: 'Orders.createdAt', dateRange: ['2026-05-01', '2026-05-07'], granularity: 'day' },
      ],
    };
    const result = deriveCompareQuery(q, 'prev');
    expect(result?.timeDimensions?.[0]).toMatchObject({
      dimension: 'Orders.createdAt',
      dateRange: ['2026-04-24', '2026-04-30'],
    });
  });

  it('shifts "today" to "yesterday"', () => {
    const q: Query = {
      measures: ['Orders.count'],
      timeDimensions: [{ dimension: 'Orders.createdAt', dateRange: 'today', granularity: 'day' }],
    };
    const result = deriveCompareQuery(q, 'prev');
    expect(result?.timeDimensions?.[0]).toMatchObject({
      dateRange: 'yesterday',
    });
  });

  it('drops dateRange when named range has no prior (unknown shape)', () => {
    const q: Query = {
      measures: ['Orders.count'],
      timeDimensions: [{ dimension: 'Orders.createdAt', dateRange: 'QTD', granularity: 'month' }],
    };
    const result = deriveCompareQuery(q, 'prev');
    // dateRange dropped — comparison has no date window; result is still a query
    expect(result?.timeDimensions?.[0]).not.toHaveProperty('dateRange');
  });

  it('shifts inDateRange filter when no timeDimension is present', () => {
    const q: Query = {
      measures: ['Events.count'],
      filters: [
        {
          member: 'Events.eventDate',
          operator: 'inDateRange',
          values: ['2026-05-01', '2026-05-07'],
        } as any,
      ],
    };
    const result = deriveCompareQuery(q, 'prev');
    const shifted = result?.filters?.find((f: any) => f.operator === 'inDateRange') as any;
    expect(shifted?.values).toEqual(['2026-04-24', '2026-04-30']);
  });

  it('preserves other filters while shifting inDateRange', () => {
    const q: Query = {
      measures: ['Events.count'],
      filters: [
        { member: 'Events.status', operator: 'equals', values: ['active'] } as any,
        { member: 'Events.date', operator: 'inDateRange', values: ['2026-05-01', '2026-05-07'] } as any,
      ],
    };
    const result = deriveCompareQuery(q, 'prev');
    expect(result?.filters).toHaveLength(2);
    const status = result?.filters?.find((f: any) => f.member === 'Events.status') as any;
    expect(status?.values).toEqual(['active']);
  });
});

// ---------------------------------------------------------------------------
// deriveCompareQuery — 'game:<id>' mode
// ---------------------------------------------------------------------------

describe('deriveCompareQuery – game mode', () => {
  it('swaps game filter value to target game', () => {
    const q: Query = {
      measures: ['dau.count'],
      filters: [
        { member: 'dau.gameId', operator: 'equals', values: ['ptg'] } as any,
      ],
    };
    const result = deriveCompareQuery(q, 'game:cfm');
    const gf = result?.filters?.find((f: any) => f.member === 'dau.gameId') as any;
    expect(gf?.values).toEqual(['cfm']);
  });

  it('swaps multiple cube game filters', () => {
    const q: Query = {
      measures: ['revenue.total'],
      filters: [
        { member: 'revenue.gameId', operator: 'equals', values: ['ptg'] } as any,
        { member: 'users.gameId', operator: 'equals', values: ['ptg'] } as any,
      ],
    };
    const result = deriveCompareQuery(q, 'game:cfm');
    result?.filters?.forEach((f: any) => {
      if (f.member?.endsWith('.gameId')) {
        expect(f.values).toEqual(['cfm']);
      }
    });
  });

  it('preserves non-gameId filters unchanged', () => {
    const q: Query = {
      measures: ['dau.count'],
      filters: [
        { member: 'dau.platform', operator: 'equals', values: ['ios'] } as any,
        { member: 'dau.gameId', operator: 'equals', values: ['ptg'] } as any,
      ],
    };
    const result = deriveCompareQuery(q, 'game:cfm');
    const platform = result?.filters?.find((f: any) => f.member === 'dau.platform') as any;
    expect(platform?.values).toEqual(['ios']);
  });

  it('returns query with no filter changes when no gameId filters present', () => {
    const q: Query = { measures: ['dau.count'] };
    const result = deriveCompareQuery(q, 'game:cfm');
    expect(result).toMatchObject({ measures: ['dau.count'] });
    expect(result?.filters).toEqual([]);
  });
});
