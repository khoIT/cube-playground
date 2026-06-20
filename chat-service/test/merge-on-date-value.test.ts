/**
 * Tests for mergeOnDateValue — the cross-cube date alignment. Verifies the two
 * red-team invariants: (C1) values align by date even though the date COLUMN
 * keys differ across cubes, and (H7) an asymmetric gap keeps the date with a
 * null on the missing side rather than dropping it.
 */

import { describe, it, expect } from 'vitest';
import { mergeOnDateValue, resolveRowKey, MERGED_DATE_KEY } from '../src/tools/merge-on-date-value.js';

describe('mergeOnDateValue', () => {
  it('aligns two series on the date value despite different date column keys', () => {
    const primaryRows = [
      { 'active_daily.log_date.day': '2026-06-01', 'active_daily.paying_dau': 40000 },
      { 'active_daily.log_date.day': '2026-06-02', 'active_daily.paying_dau': 41000 },
    ];
    const overlayRows = [
      { 'user_recharge_daily.log_date.day': '2026-06-01', 'user_recharge_daily.revenue_vnd_total': 8000000 },
      { 'user_recharge_daily.log_date.day': '2026-06-02', 'user_recharge_daily.revenue_vnd_total': 8200000 },
    ];
    const merged = mergeOnDateValue(
      { rows: primaryRows, dateKey: 'active_daily.log_date.day', valueKey: 'active_daily.paying_dau' },
      { rows: overlayRows, dateKey: 'user_recharge_daily.log_date.day', valueKey: 'user_recharge_daily.revenue_vnd_total' },
    );
    expect(merged).toEqual([
      { [MERGED_DATE_KEY]: '2026-06-01', 'active_daily.paying_dau': 40000, 'user_recharge_daily.revenue_vnd_total': 8000000 },
      { [MERGED_DATE_KEY]: '2026-06-02', 'active_daily.paying_dau': 41000, 'user_recharge_daily.revenue_vnd_total': 8200000 },
    ]);
  });

  it('keeps an asymmetric-gap date with the missing side omitted (never drops it)', () => {
    const primaryRows = [
      { 'a.log_date.day': '2026-06-01', 'a.m': 10 },
      { 'a.log_date.day': '2026-06-02', 'a.m': 20 }, // only primary has 06-02
    ];
    const overlayRows = [
      { 'b.log_date.day': '2026-06-01', 'b.n': 100 },
      { 'b.log_date.day': '2026-06-03', 'b.n': 300 }, // only overlay has 06-03
    ];
    const merged = mergeOnDateValue(
      { rows: primaryRows, dateKey: 'a.log_date.day', valueKey: 'a.m' },
      { rows: overlayRows, dateKey: 'b.log_date.day', valueKey: 'b.n' },
    );
    // Union of dates, sorted; gaps keep the row with only one side present.
    expect(merged.map((r) => r[MERGED_DATE_KEY])).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(merged[1]).toEqual({ [MERGED_DATE_KEY]: '2026-06-02', 'a.m': 20 }); // no b.n key
    expect(merged[2]).toEqual({ [MERGED_DATE_KEY]: '2026-06-03', 'b.n': 300 }); // no a.m key
  });

  it('returns empty when neither series has rows', () => {
    expect(
      mergeOnDateValue({ rows: [], dateKey: 'a.d', valueKey: 'a.m' }, { rows: [], dateKey: 'b.d', valueKey: 'b.n' }),
    ).toEqual([]);
  });
});

describe('resolveRowKey', () => {
  const rows = [{ 'active_daily.log_date.day': '2026-06-01', 'active_daily.paying_dau': 1 }];
  it('prefers the granularity-suffixed key for a time dimension', () => {
    expect(resolveRowKey(rows, 'active_daily.log_date', 'day')).toBe('active_daily.log_date.day');
  });
  it('uses the bare ref for a measure', () => {
    expect(resolveRowKey(rows, 'active_daily.paying_dau')).toBe('active_daily.paying_dau');
  });
  it('falls back to the member itself on an empty row set', () => {
    expect(resolveRowKey([], 'active_daily.paying_dau')).toBe('active_daily.paying_dau');
  });
});
