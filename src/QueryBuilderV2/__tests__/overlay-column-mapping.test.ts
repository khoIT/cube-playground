/**
 * Tests for buildOverlayValueByDate — the date-matching that lets the Results
 * grid show the overlay measure beside the primary. The overlay rows carry a
 * cube-prefixed, granular time key (e.g. "user_recharge_daily.log_date.day")
 * whose VALUE has a time suffix; the grid matches by date portion, so the map
 * must key on YYYY-MM-DD and coerce string measure values to numbers.
 */
import { describe, it, expect } from 'vitest';
import { buildOverlayValueByDate, datePortion } from '../use-overlay-column';
import type { Query } from '@cubejs-client/core';

const overlayQuery = {
  measures: ['user_recharge_daily.revenue_vnd_total'],
  timeDimensions: [{ dimension: 'user_recharge_daily.log_date', granularity: 'day', dateRange: ['2026-06-11', '2026-06-12'] }],
} as unknown as Query;

describe('datePortion', () => {
  it('takes the YYYY-MM-DD prefix of an ISO datetime', () => {
    expect(datePortion('2026-06-11T00:00:00.000')).toBe('2026-06-11');
    expect(datePortion('2026-06-11')).toBe('2026-06-11');
    expect(datePortion(undefined)).toBe('');
  });
});

describe('buildOverlayValueByDate', () => {
  it('maps date portion → numeric value (granular time key, string values)', () => {
    const rows = [
      { 'user_recharge_daily.log_date.day': '2026-06-11T00:00:00.000', 'user_recharge_daily.revenue_vnd_total': '1810000000' },
      { 'user_recharge_daily.log_date.day': '2026-06-12T00:00:00.000', 'user_recharge_daily.revenue_vnd_total': '2960000000' },
    ];
    const m = buildOverlayValueByDate(rows, overlayQuery);
    expect(m.get('2026-06-11')).toBe(1_810_000_000);
    expect(m.get('2026-06-12')).toBe(2_960_000_000);
    expect(m.size).toBe(2);
  });

  it('skips rows with null/undefined or non-numeric values', () => {
    const rows = [
      { 'user_recharge_daily.log_date.day': '2026-06-11T00:00:00.000', 'user_recharge_daily.revenue_vnd_total': null as unknown as string },
      { 'user_recharge_daily.log_date.day': '2026-06-12T00:00:00.000', 'user_recharge_daily.revenue_vnd_total': 500 },
    ];
    const m = buildOverlayValueByDate(rows, overlayQuery);
    expect(m.has('2026-06-11')).toBe(false);
    expect(m.get('2026-06-12')).toBe(500);
  });

  it('returns an empty map when there are no rows or no measure', () => {
    expect(buildOverlayValueByDate([], overlayQuery).size).toBe(0);
    expect(buildOverlayValueByDate([{ x: 1 }], { measures: [] } as unknown as Query).size).toBe(0);
  });
});
