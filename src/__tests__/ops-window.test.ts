/**
 * Ops Console window math — current/prior ranges per window + Δ helper.
 * Pins the rule: Δ-vs-prior exists ONLY for 7d (30d/MTD have no prior range,
 * because there is no billing history before ~mid-May → a fake +∞% Δ otherwise).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { opsWindowRanges, pctDelta } from '../pages/OpsConsole/ops-window';

const TODAY = new Date('2026-06-14T09:00:00Z');

describe('opsWindowRanges', () => {
  it('7d → 7 inclusive days + an equal-length prior period', () => {
    const r = opsWindowRanges('7d', TODAY);
    expect(r.current).toEqual({ start: '2026-06-08', end: '2026-06-14' });
    expect(r.prior).toEqual({ start: '2026-06-01', end: '2026-06-07' });
  });

  it('30d → 30 inclusive days, NO prior (no data before mid-May)', () => {
    const r = opsWindowRanges('30d', TODAY);
    expect(r.current).toEqual({ start: '2026-05-16', end: '2026-06-14' });
    expect(r.prior).toBeNull();
  });

  it('MTD → first-of-month to today, NO prior', () => {
    const r = opsWindowRanges('mtd', TODAY);
    expect(r.current).toEqual({ start: '2026-06-01', end: '2026-06-14' });
    expect(r.prior).toBeNull();
  });

  it('MTD edge: on the 1st, current is a single day', () => {
    const r = opsWindowRanges('mtd', new Date('2026-07-01T00:00:00Z'));
    expect(r.current).toEqual({ start: '2026-07-01', end: '2026-07-01' });
  });

  it('every window is ≤ 31 days (satisfies the billing scan guard)', () => {
    for (const w of ['7d', '30d', 'mtd'] as const) {
      const { current } = opsWindowRanges(w, TODAY);
      const days =
        (Date.parse(`${current.end}T00:00:00Z`) - Date.parse(`${current.start}T00:00:00Z`)) /
          86_400_000 +
        1;
      expect(days).toBeLessThanOrEqual(31);
    }
  });
});

describe('pctDelta', () => {
  it('computes a signed fraction', () => {
    expect(pctDelta(110, 100)).toBeCloseTo(0.1);
    expect(pctDelta(90, 100)).toBeCloseTo(-0.1);
  });
  it('returns null when prior is 0 or missing (no fake +∞%)', () => {
    expect(pctDelta(50, 0)).toBeNull();
    expect(pctDelta(50, null)).toBeNull();
    expect(pctDelta(50, undefined)).toBeNull();
  });
});
