/**
 * FE mirror of chat-service merge-on-date-value tests — same invariants so the
 * builder center and the chat card align two cross-cube series identically.
 */
import { describe, it, expect } from 'vitest';
import { mergeOnDateValue, resolveRowKey, MERGED_DATE_KEY } from '../merge-on-date-value';

describe('mergeOnDateValue (FE)', () => {
  it('aligns on the date value across differing date column keys', () => {
    const merged = mergeOnDateValue(
      {
        rows: [
          { 'a.log_date.day': '2026-06-01', 'a.dau': 40000 },
          { 'a.log_date.day': '2026-06-02', 'a.dau': 41000 },
        ],
        dateKey: 'a.log_date.day',
        valueKey: 'a.dau',
      },
      {
        rows: [
          { 'b.log_date.day': '2026-06-01', 'b.rev': 8000000 },
          { 'b.log_date.day': '2026-06-02', 'b.rev': 8200000 },
        ],
        dateKey: 'b.log_date.day',
        valueKey: 'b.rev',
      },
    );
    expect(merged).toEqual([
      { [MERGED_DATE_KEY]: '2026-06-01', 'a.dau': 40000, 'b.rev': 8000000 },
      { [MERGED_DATE_KEY]: '2026-06-02', 'a.dau': 41000, 'b.rev': 8200000 },
    ]);
  });

  it('keeps asymmetric-gap dates with the missing side omitted', () => {
    const merged = mergeOnDateValue(
      { rows: [{ 'a.d.day': '2026-06-02', 'a.m': 20 }], dateKey: 'a.d.day', valueKey: 'a.m' },
      { rows: [{ 'b.d.day': '2026-06-03', 'b.n': 300 }], dateKey: 'b.d.day', valueKey: 'b.n' },
    );
    expect(merged.map((r) => r[MERGED_DATE_KEY])).toEqual(['2026-06-02', '2026-06-03']);
    expect(merged[0]).toEqual({ [MERGED_DATE_KEY]: '2026-06-02', 'a.m': 20 });
    expect(merged[1]).toEqual({ [MERGED_DATE_KEY]: '2026-06-03', 'b.n': 300 });
  });
});

describe('resolveRowKey (FE)', () => {
  const rows = [{ 'a.log_date.day': '2026-06-01', 'a.dau': 1 }];
  it('prefers the granularity-suffixed time key', () => {
    expect(resolveRowKey(rows, 'a.log_date', 'day')).toBe('a.log_date.day');
  });
  it('falls back to the member itself when rows are empty', () => {
    expect(resolveRowKey([], 'a.dau')).toBe('a.dau');
  });
});
