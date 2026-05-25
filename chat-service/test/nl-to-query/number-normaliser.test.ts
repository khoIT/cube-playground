import { describe, it, expect } from 'vitest';
import { parseNumbers } from '../../src/nl-to-query/number-normaliser.js';

describe('number-normaliser', () => {
  it('parses VI million shorthand "10tr"', () => {
    const out = parseNumbers('paying user trên 10tr', { isVietnameseContext: true });
    expect(out[0].value).toBe(10_000_000);
  });

  it('parses VI thousand "5 nghìn"', () => {
    const out = parseNumbers('5 nghìn người', { isVietnameseContext: true });
    expect(out[0].value).toBe(5000);
  });

  it('parses billion "1 tỷ"', () => {
    const out = parseNumbers('doanh thu 1 tỷ', { isVietnameseContext: true });
    expect(out[0].value).toBe(1_000_000_000);
  });

  it('decimal "10.5tr" → 10_500_000', () => {
    const out = parseNumbers('10.5tr', { isVietnameseContext: true });
    expect(out[0].value).toBe(10_500_000);
  });

  it('VI thousand separator "1.000" → 1000 with warning', () => {
    const out = parseNumbers('giá 1.000 đồng', { isVietnameseContext: true });
    expect(out[0].value).toBe(1000);
    expect(out[0].warnings.join(' ')).toMatch(/thousands separator/i);
  });

  it('EN decimal "1.0" stays 1', () => {
    const out = parseNumbers('1.000 USD', { isVietnameseContext: false });
    expect(out[0].value).toBe(1);
  });

  it('per-period "5tr/tháng" tags monthly', () => {
    const out = parseNumbers('ngưỡng 5tr/tháng', { isVietnameseContext: true });
    expect(out[0].perPeriod).toBe('month');
    expect(out[0].value).toBe(5_000_000);
  });
});
