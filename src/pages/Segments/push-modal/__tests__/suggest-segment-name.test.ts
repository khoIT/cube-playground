/**
 * suggest-segment-name behaviours:
 *  - friendlyCohortValue compacts dates per granularity without TZ drift
 *  - weekdayRestatement names the weekday of a calendar date
 *  - suggestSegmentName assembles a name from selected cohort values
 */
import { describe, it, expect } from 'vitest';
import {
  friendlyCohortValue,
  weekdayRestatement,
  suggestSegmentName,
} from '../suggest-segment-name';

describe('friendlyCohortValue', () => {
  it('compacts day buckets to "Mon D"', () => {
    expect(friendlyCohortValue('2026-06-05T00:00:00.000', 'day')).toBe('Jun 5');
    expect(friendlyCohortValue('2026-06-05', 'day')).toBe('Jun 5');
  });

  it('renders month/year/week granularities', () => {
    expect(friendlyCohortValue('2026-05-01T00:00:00.000', 'month')).toBe('May 2026');
    expect(friendlyCohortValue('2026-01-01', 'year')).toBe('2026');
    expect(friendlyCohortValue('2026-05-04', 'week')).toBe('wk of May 4');
  });

  it('passes non-date values through untouched', () => {
    expect(friendlyCohortValue('android')).toBe('android');
  });
});

describe('weekdayRestatement', () => {
  it('names the weekday of a calendar date (2026-06-05 is a Friday)', () => {
    expect(weekdayRestatement('2026-06-05')).toBe('Fri, Jun 5');
    expect(weekdayRestatement('2026-06-05T00:00:00.000')).toBe('Fri, Jun 5');
  });

  it('returns null for non-dates', () => {
    expect(weekdayRestatement('android')).toBeNull();
  });
});

describe('suggestSegmentName', () => {
  const gran = { 'user_recharge_daily.log_date.day': 'day' };

  it('builds a name from a single day cohort', () => {
    expect(
      suggestSegmentName(
        [
          {
            column: 'user_recharge_daily.log_date.day',
            topValues: [{ value: '2026-06-05T00:00:00.000', count: 1 }],
          },
        ],
        gran,
      ),
    ).toBe('Jun 5');
  });

  it('joins multiple cohort columns and marks extra values', () => {
    expect(
      suggestSegmentName(
        [
          { column: 'mf_users.os_platform', topValues: [{ value: 'android', count: 3 }] },
          {
            column: 'user_recharge_daily.log_date.day',
            topValues: [
              { value: '2026-06-05', count: 2 },
              { value: '2026-06-06', count: 1 },
            ],
          },
        ],
        gran,
      ),
    ).toBe('android · Jun 5 +1');
  });

  it('returns empty string when there is nothing usable', () => {
    expect(suggestSegmentName([], {})).toBe('');
  });
});
