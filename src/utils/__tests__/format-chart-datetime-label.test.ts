import { describe, expect, it } from 'vitest';
import {
  formatChartDateTooltip,
  isDateLikeLabel,
  makeTimeTickFormatter,
  parseDateLikeLabel,
} from '../format-chart-datetime-label';

describe('parseDateLikeLabel / isDateLikeLabel', () => {
  it('parses date-only ISO strings', () => {
    expect(parseDateLikeLabel('2026-04-07')).toEqual({ year: 2026, month: 4, day: 7, time: null });
  });

  it('parses Cube-style midnight timestamps as date-grain', () => {
    expect(parseDateLikeLabel('2026-04-07T00:00:00.000')).toEqual({
      year: 2026, month: 4, day: 7, time: null,
    });
  });

  it('keeps non-midnight times as hour grain', () => {
    expect(parseDateLikeLabel('2026-04-07T14:30:00.000')?.time).toBe('14:30');
  });

  it('rejects non-date values', () => {
    expect(isDateLikeLabel('VN')).toBe(false);
    expect(isDateLikeLabel('minnow')).toBe(false);
    expect(isDateLikeLabel(1234)).toBe(false);
    expect(isDateLikeLabel(null)).toBe(false);
    expect(isDateLikeLabel('2026-13-40')).toBe(false);
  });
});

describe('formatChartDateTooltip', () => {
  it('always carries the year', () => {
    expect(formatChartDateTooltip('2026-04-07T00:00:00.000')).toBe('Apr 7, 2026');
  });

  it('appends the time for hour-grain values', () => {
    expect(formatChartDateTooltip('2026-04-07T14:00:00.000')).toBe('Apr 7, 2026 14:00');
  });

  it('passes non-date labels through', () => {
    expect(formatChartDateTooltip('VN')).toBe('VN');
  });
});

describe('makeTimeTickFormatter', () => {
  it('truncates a single-year day series without years', () => {
    const fmt = makeTimeTickFormatter(['2026-04-07T00:00:00.000', '2026-06-06T00:00:00.000']);
    expect(fmt('2026-04-07T00:00:00.000')).toBe('Apr 7');
    expect(fmt('2026-06-06T00:00:00.000')).toBe('Jun 6');
  });

  it('appends hours for hour-grain values', () => {
    const fmt = makeTimeTickFormatter(['2026-04-07T13:00:00.000', '2026-04-07T14:00:00.000']);
    expect(fmt('2026-04-07T14:00:00.000')).toBe('Apr 7 14:00');
  });

  it('marks the first tick and year boundaries when the range crosses years', () => {
    const fmt = makeTimeTickFormatter(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(fmt('2026-12-30')).toBe('Dec 30, 2026');
    expect(fmt('2026-12-31')).toBe('Dec 31');
    expect(fmt('2027-01-01')).toBe('Jan 1, 2027');
    expect(fmt('2027-01-02')).toBe('Jan 2');
  });

  it('passes categorical values through unchanged', () => {
    const fmt = makeTimeTickFormatter(['VN', 'US', 'JP']);
    expect(fmt('VN')).toBe('VN');
  });

  it('formats values missing from the prepared series via the tooltip fallback', () => {
    const fmt = makeTimeTickFormatter(['2026-04-07']);
    expect(fmt('2026-05-01')).toBe('May 1, 2026');
  });
});
