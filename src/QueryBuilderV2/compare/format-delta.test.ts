/**
 * Tests for format-delta.ts
 *
 * Covers: abs delta formatting, pct formatting, null/Infinity guards,
 * getDeltaTone neutral fallback.
 */

import { describe, it, expect } from 'vitest';
import { formatDeltaAbs, formatDeltaPct, getDeltaTone } from './format-delta';

// ---------------------------------------------------------------------------
// formatDeltaAbs
// ---------------------------------------------------------------------------

describe('formatDeltaAbs', () => {
  it('formats positive delta with + prefix', () => {
    const result = formatDeltaAbs(1234);
    expect(result).toContain('+');
    expect(result).toContain('1,234');
  });

  it('formats negative delta with - prefix', () => {
    const result = formatDeltaAbs(-500);
    expect(result).toContain('-');
    expect(result).toContain('500');
  });

  it('formats zero as "0"', () => {
    const result = formatDeltaAbs(0);
    expect(result).not.toContain('+');
    expect(result).toContain('0');
  });

  it('returns "—" for null', () => {
    expect(formatDeltaAbs(null)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatDeltaAbs(undefined)).toBe('—');
  });

  it('returns "—" for Infinity', () => {
    expect(formatDeltaAbs(Infinity)).toBe('—');
  });

  it('returns "—" for NaN', () => {
    expect(formatDeltaAbs(NaN)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// formatDeltaPct
// ---------------------------------------------------------------------------

describe('formatDeltaPct', () => {
  it('formats positive pct with + prefix', () => {
    expect(formatDeltaPct(0.123)).toBe('+12.3%');
  });

  it('formats negative pct', () => {
    expect(formatDeltaPct(-0.05)).toBe('-5.0%');
  });

  it('formats zero without + prefix', () => {
    expect(formatDeltaPct(0)).toBe('0.0%');
  });

  it('returns "—" for null (zero denominator / missing row)', () => {
    expect(formatDeltaPct(null)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatDeltaPct(undefined)).toBe('—');
  });

  it('returns "—" for Infinity', () => {
    expect(formatDeltaPct(Infinity)).toBe('—');
  });

  it('rounds to 1 decimal place', () => {
    // 0.1667 * 100 = 16.67 → 16.7%
    expect(formatDeltaPct(0.1667)).toBe('+16.7%');
  });
});

// ---------------------------------------------------------------------------
// getDeltaTone
// ---------------------------------------------------------------------------

describe('getDeltaTone', () => {
  it('returns "neutral" for null deltaPct', () => {
    expect(getDeltaTone(null)).toBe('neutral');
  });

  it('returns "neutral" for zero deltaPct', () => {
    expect(getDeltaTone(0)).toBe('neutral');
  });

  it('returns "positive" for positive deltaPct', () => {
    expect(getDeltaTone(0.1)).toBe('positive');
  });

  it('returns "negative" for negative deltaPct', () => {
    expect(getDeltaTone(-0.1)).toBe('negative');
  });

  it('returns "neutral" for undefined', () => {
    expect(getDeltaTone(undefined)).toBe('neutral');
  });
});
