/**
 * trailingWindowFilter — the offset param lets lens-02 compare two equal-length
 * 30-day windows (recent vs preceding) instead of a 30d-vs-90d span that both
 * over-counts additive measures AND blows the 31-day cap on high-volume cubes.
 */

import { describe, it, expect } from 'vitest';
import { trailingWindowFilter } from '../src/advisor/scope-helpers.js';

const asOf = new Date('2026-06-15T00:00:00Z');

describe('trailingWindowFilter', () => {
  it('default offset = trailing window ending at asOf', () => {
    const f = trailingWindowFilter('billing_detail.order_date', asOf, 30) as {
      member: string;
      operator: string;
      values: string[];
    };
    expect(f.member).toBe('billing_detail.order_date');
    expect(f.operator).toBe('inDateRange');
    expect(f.values).toEqual(['2026-05-16', '2026-06-15']);
  });

  it('offsetDays shifts the window back, keeping its length', () => {
    const prior = trailingWindowFilter('billing_detail.order_date', asOf, 30, 30) as { values: string[] };
    // 30-day window ending 30 days before asOf (days 30–60 ago).
    expect(prior.values).toEqual(['2026-04-16', '2026-05-16']);
  });

  it('recent and prior 30-day windows abut and are each ≤31 days', () => {
    const recent = trailingWindowFilter('d', asOf, 30) as { values: string[] };
    const prior = trailingWindowFilter('d', asOf, 30, 30) as { values: string[] };
    // prior end == recent start (abutting, no gap/overlap)
    expect(prior.values[1]).toBe(recent.values[0]);
    const span = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    expect(span(recent.values[0], recent.values[1])).toBeLessThanOrEqual(31);
    expect(span(prior.values[0], prior.values[1])).toBeLessThanOrEqual(31);
  });
});
