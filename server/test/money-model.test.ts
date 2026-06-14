/**
 * Tests for money-model.ts — incremental revenue estimation.
 */
import { describe, expect, it } from 'vitest';
import { expectedIncremental } from '../src/advisor/money-model.js';

describe('expectedIncremental', () => {
  it('TBD path: returns null monetary fields when valuePerUnit is absent', () => {
    const result = expectedIncremental({
      effectFraction: 0.06,
      addressableN: 2400,
    });

    expect(result.incrementalVnd).toBeNull();
    expect(result.perUnitVnd).toBeNull();
    expect(result.note).toMatch(/TBD/);
    expect(result.note).toMatch(/pending business sign-off/);
    expect(result.currency).toBe('VND');
  });

  it('TBD path: explicit null valuePerUnit triggers TBD', () => {
    const result = expectedIncremental({
      effectFraction: 0.06,
      addressableN: 2400,
      valuePerUnit: null,
    });

    expect(result.incrementalVnd).toBeNull();
  });

  it('known ₫/unit: computes correct incremental', () => {
    // 2400 × 0.06 × 850_000 = 122_400_000
    const result = expectedIncremental({
      effectFraction: 0.06,
      addressableN: 2400,
      valuePerUnit: 850_000,
    });

    expect(result.incrementalVnd).toBe(122_400_000);
    expect(result.perUnitVnd).toBe(850_000);
    expect(result.note).toContain('850,000');
    expect(result.note).toContain('6.0%');
    expect(result.note).toContain('2,400');
    expect(result.currency).toBe('VND');
  });

  it('zero effect fraction → zero incremental', () => {
    const result = expectedIncremental({
      effectFraction: 0,
      addressableN: 2400,
      valuePerUnit: 850_000,
    });

    expect(result.incrementalVnd).toBe(0);
  });

  it('custom currency (jus_vn USD path)', () => {
    const result = expectedIncremental({
      effectFraction: 0.05,
      addressableN: 1000,
      valuePerUnit: 10,
      currency: 'USD',
    });

    expect(result.currency).toBe('USD');
    expect(result.incrementalVnd).toBe(500); // 1000 × 0.05 × 10
    expect(result.note).toContain('USD');
  });

  it('rounds to integer VND', () => {
    // 100 × 0.333 × 100 = 3330 (rounds)
    const result = expectedIncremental({
      effectFraction: 0.333,
      addressableN: 100,
      valuePerUnit: 100,
    });

    expect(Number.isInteger(result.incrementalVnd)).toBe(true);
  });
});
