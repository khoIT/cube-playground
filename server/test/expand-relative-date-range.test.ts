/**
 * Relative-date expansion. Focus on the "last N hours" support added so sub-day
 * care-playbook windows ("last 24 hours") compile to a real inDateRange instead of
 * being dropped (which previously collapsed the cohort to the full population).
 */

import { describe, it, expect } from 'vitest';
import { expandRelativeDateRange, expandAnniversaryWindows, anniversaryMilestoneForDate, ANNIVERSARY_OFFSET_DAYS } from '../src/services/expand-relative-date-range.js';

const NOW = new Date('2026-06-09T12:00:00.000Z');

describe('expandAnniversaryWindows', () => {
  it('returns one single-day range per milestone offset before the anchor', () => {
    const anchor = new Date(2026, 4, 4); // 2026-05-04 local
    const windows = expandAnniversaryWindows(anchor);
    expect(windows).toHaveLength(ANNIVERSARY_OFFSET_DAYS.length);
    // 30d before 2026-05-04 = 2026-04-04, expressed as a single calendar day
    expect(windows[0]).toEqual(['2026-04-04', '2026-04-04']);
    for (const [start, end] of windows) expect(start).toBe(end);
  });
});

describe('anniversaryMilestoneForDate', () => {
  const anchor = new Date(2026, 5, 9); // 2026-06-09 local

  it('attributes each milestone offset exactly', () => {
    for (const n of ANNIVERSARY_OFFSET_DAYS) {
      const firstSeen = new Date(anchor);
      firstSeen.setDate(firstSeen.getDate() - n);
      expect(anniversaryMilestoneForDate(firstSeen, anchor)).toBe(n);
    }
  });

  it('absorbs ±1-day anchor/timezone drift', () => {
    const off = new Date(anchor);
    off.setDate(off.getDate() - 366); // one day past the 365 milestone
    expect(anniversaryMilestoneForDate(off, anchor)).toBe(365);
  });

  it('returns null for a date on no milestone', () => {
    const between = new Date(anchor);
    between.setDate(between.getDate() - 200); // between 180 and 365
    expect(anniversaryMilestoneForDate(between, anchor)).toBeNull();
  });

  it('returns null for an unparseable date', () => {
    expect(anniversaryMilestoneForDate(new Date('not-a-date'), anchor)).toBeNull();
  });
});

describe('expandRelativeDateRange — hours', () => {
  it('expands "last 24 hours" to a precise 24h datetime window ending now', () => {
    const r = expandRelativeDateRange('last 24 hours', NOW);
    expect(r).toEqual(['2026-06-08T12:00:00.000Z', '2026-06-09T12:00:00.000Z']);
  });

  it('expands "last 48 hours" (used by 48h playbooks) to a 48h window', () => {
    const r = expandRelativeDateRange('last 48 hours', NOW);
    expect(r).toEqual(['2026-06-07T12:00:00.000Z', '2026-06-09T12:00:00.000Z']);
  });

  it('accepts the singular "last 1 hour" and is case-insensitive', () => {
    expect(expandRelativeDateRange('LAST 1 HOUR', NOW)).toEqual([
      '2026-06-09T11:00:00.000Z',
      '2026-06-09T12:00:00.000Z',
    ]);
  });

  it('still returns null for unsupported windows (anniversary/birthday)', () => {
    expect(expandRelativeDateRange('anniversary', NOW)).toBeNull();
    expect(expandRelativeDateRange('birthday', NOW)).toBeNull();
    expect(expandRelativeDateRange('next 3 days', NOW)).toBeNull();
  });

  it('still expands the existing day window form', () => {
    const r = expandRelativeDateRange('last 1 day', NOW);
    expect(r?.[0]).toMatch(/^2026-06-09/); // day-granular, inclusive of today
  });
});
