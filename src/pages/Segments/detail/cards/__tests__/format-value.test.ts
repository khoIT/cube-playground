import { describe, expect, it } from 'vitest';
import { formatCompact, formatValue, formatValueExact } from '../format-value';
import { cardUnitChip, resolveCardUnit } from '../resolve-card-unit';

describe('formatCompact', () => {
  it('keeps small numbers exact', () => {
    expect(formatCompact(932)).toBe('932');
  });

  it('formats thousands with one decimal', () => {
    expect(formatCompact(7612)).toBe('7.6k');
  });

  it('formats millions with up to two decimals, trimming zeros', () => {
    expect(formatCompact(1_355_623)).toBe('1.36M');
    expect(formatCompact(2_000_000)).toBe('2M');
  });

  it('formats billions', () => {
    expect(formatCompact(10_286_465_000)).toBe('10.29B');
  });

  it('handles negatives', () => {
    expect(formatCompact(-1_500_000)).toBe('-1.5M');
  });
});

describe('formatValue', () => {
  it('compacts million-and-above currency', () => {
    expect(formatValue(10_286_465_000, 'currency')).toBe('₫10.29B');
    expect(formatValue(1_355_623, 'currency')).toBe('₫1.36M');
  });

  it('keeps sub-million currency exact', () => {
    expect(formatValue(355_623, 'currency')).toMatch(/355,623/);
  });

  it('compacts million-and-above plain numbers', () => {
    expect(formatValue(12_345_678, 'number')).toBe('12.35M');
  });

  it('keeps sub-million plain numbers thousands-separated', () => {
    expect(formatValue(82_400, 'number')).toBe('82,400');
  });
});

describe('formatValueExact', () => {
  it('returns the exact currency for compacted values', () => {
    expect(formatValueExact(10_286_465_000, 'currency')).toMatch(/10,286,465,000/);
  });

  it('returns null when display already carries full precision', () => {
    expect(formatValueExact(355_623, 'currency')).toBeNull();
    expect(formatValueExact(82_400, 'number')).toBeNull();
    expect(formatValueExact(0.42, 'percent')).toBeNull();
  });
});

describe('resolveCardUnit / cardUnitChip', () => {
  it('derives currency codes', () => {
    expect(resolveCardUnit('recharge.revenue_vnd')).toBe('VND');
  });

  it('derives users from count measures', () => {
    expect(resolveCardUnit('mf_users.user_count')).toBe('users');
    expect(resolveCardUnit('mf_users.installs_90d')).toBe('users');
  });

  it('derives percent from rate measures', () => {
    expect(resolveCardUnit('mf_users.paying_rate_30d')).toBe('%');
  });

  it('shows the chip when it adds info beyond the title', () => {
    expect(cardUnitChip('mf_users.user_count', 'Installs (last 90 days)')).toBe('users');
  });

  it('hides the chip when the title already says it', () => {
    expect(cardUnitChip('mf_users.user_count', 'Users by country')).toBeNull();
  });
});
