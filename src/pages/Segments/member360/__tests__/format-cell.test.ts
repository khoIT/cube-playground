/**
 * format-cell — compact currency (B tier via the shared core), date-relative,
 * tenure, exact-tooltip counterparts, and legacy passthrough behavior.
 */
import { describe, it, expect } from 'vitest';
import { formatCell, formatCellExact } from '../format-cell';

// Fixed "now" so relative tiers are deterministic (GMT+7 business dates).
const NOW = new Date(2026, 5, 7); // 7 Jun 2026

describe('formatCell — currency/compact via shared core', () => {
  it('compacts million-and-above currency with ₫ prefix', () => {
    expect(formatCell(10_286_465_000, 'currency')).toBe('₫10.29B');
    expect(formatCell(45_200_000, 'currency')).toBe('₫45.2M');
  });

  it('keeps sub-million currency exact', () => {
    expect(formatCell(750_000, 'currency')).toMatch(/750/); // locale-formatted full VND
  });

  it('compact format gains the B tier', () => {
    expect(formatCell(10_286_465_000, 'compact')).toBe('10.29B');
    expect(formatCell(7_612, 'compact')).toBe('7.6k');
    expect(formatCell(932, 'compact')).toBe('932');
  });
});

describe('formatCell — date-relative', () => {
  it('today collapses to "Today"', () => {
    expect(formatCell('2026-06-07', 'date-relative', NOW)).toBe('Today');
  });

  it('recent date gets a d-ago suffix', () => {
    expect(formatCell('2026-06-04', 'date-relative', NOW)).toBe('4 Jun 2026 (3d ago)');
  });

  it('older dates tier to months and years', () => {
    expect(formatCell('2026-01-07', 'date-relative', NOW)).toBe('7 Jan 2026 (5mo ago)');
    expect(formatCell('2025-01-12', 'date-relative', NOW)).toBe('12 Jan 2025 (1.4y ago)');
  });

  it('non-date input falls back to its string form', () => {
    expect(formatCell('not-a-date', 'date-relative', NOW)).toBe('not-a-date');
  });
});

describe('formatCell — tenure', () => {
  it('adds a year approximation past 365d', () => {
    expect(formatCell(412, 'tenure')).toBe('412d (~1.1y)');
  });
  it('stays days-only under a year', () => {
    expect(formatCell(89, 'tenure')).toBe('89d');
  });
});

describe('formatCell — legacy behavior unchanged', () => {
  it('bare ISO date/timestamp shortening without format', () => {
    expect(formatCell('2026-06-05')).toBe('2026-06-05');
    expect(formatCell('2026-06-05T13:45:00')).toBe('2026-06-05 13:45');
  });
  it('duration, percent, number, null', () => {
    expect(formatCell(3900, 'duration')).toBe('1h 5m');
    expect(formatCell(0.123, 'percent')).toBe('12.3%');
    expect(formatCell(1234, 'number')).toBe('1,234');
    expect(formatCell(null)).toBe('—');
    expect(formatCell('')).toBe('—');
  });
});

describe('formatCellExact — tooltip counterparts', () => {
  it('returns full VND for compacted currency, null when display already exact', () => {
    expect(formatCellExact(10_286_465_000, 'currency')).toMatch(/10.286.465.000/);
    expect(formatCellExact(750_000, 'currency')).toBeNull();
  });
  it('returns the raw value for derived date/tenure forms', () => {
    expect(formatCellExact('2026-06-07', 'date-relative')).toBe('2026-06-07');
    expect(formatCellExact(412, 'tenure')).toBe('412');
  });
  it('null for non-lossy or empty values', () => {
    expect(formatCellExact('VN', undefined)).toBeNull();
    expect(formatCellExact(null, 'currency')).toBeNull();
    expect(formatCellExact(932, 'compact')).toBeNull();
  });
});
