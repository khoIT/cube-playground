/**
 * VIP tier resolution — the highest ₫5/20/50/100M band a cumulative LTV clears.
 * Locks the band boundaries the tier badge renders from.
 */

import { describe, it, expect } from 'vitest';
import { vipTier } from '../vip-tier';

describe('vipTier', () => {
  it('returns null below the entry band or for unknown values', () => {
    expect(vipTier(4_999_999)).toBeNull();
    expect(vipTier(null)).toBeNull();
    expect(vipTier(undefined)).toBeNull();
    expect(vipTier(Number.NaN)).toBeNull();
  });

  it('resolves each band at its threshold', () => {
    expect(vipTier(5_000_000)?.level).toBe(1);
    expect(vipTier(20_000_000)?.level).toBe(2);
    expect(vipTier(50_000_000)?.level).toBe(3);
    expect(vipTier(100_000_000)?.level).toBe(4);
  });

  it('picks the highest band cleared, not the lowest', () => {
    const t = vipTier(75_000_000);
    expect(t?.level).toBe(3);
    expect(t?.short).toBe('₫50M');
    expect(vipTier(250_000_000)?.level).toBe(4); // above top band stays T4
  });
});
