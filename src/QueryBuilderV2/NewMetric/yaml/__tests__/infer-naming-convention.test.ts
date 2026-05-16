import { describe, it, expect } from 'vitest';
import { inferConvention, adaptName, snakeToCamel } from '../infer-naming-convention';

describe('inferConvention()', () => {
  it('returns snake for empty peers', () => {
    expect(inferConvention([])).toBe('snake');
  });

  it('returns snake when all peers are snake_case', () => {
    expect(inferConvention(['total_revenue', 'order_count', 'avg_value'])).toBe('snake');
  });

  it('returns camel when all peers are camelCase', () => {
    expect(inferConvention(['totalRevenue', 'orderCount', 'avgValue'])).toBe('camel');
  });

  it('returns snake on tie (50/50 split)', () => {
    expect(inferConvention(['total_revenue', 'orderCount'])).toBe('snake');
  });

  it('returns snake when majority are snake', () => {
    expect(inferConvention(['total_revenue', 'order_count', 'avgValue'])).toBe('snake');
  });

  it('returns camel when majority are camel', () => {
    expect(inferConvention(['totalRevenue', 'orderCount', 'avg_value'])).toBe('camel');
  });

  it('ignores leading-underscore names (they match neither pattern)', () => {
    // _bad does not match /^[a-z].../ so counts as neither
    expect(inferConvention(['_bad', 'total_revenue', 'order_count'])).toBe('snake');
  });

  it('treats single lowercase word as snake (no uppercase)', () => {
    expect(inferConvention(['count', 'total', 'sum'])).toBe('snake');
  });

  it('does not classify mixed-case with underscore as camel', () => {
    // "total_Revenue" has uppercase but also underscore → not camelCase pattern
    expect(inferConvention(['total_Revenue', 'total_revenue'])).toBe('snake');
  });
});

describe('snakeToCamel()', () => {
  it('converts basic snake_case', () => {
    expect(snakeToCamel('total_revenue')).toBe('totalRevenue');
  });

  it('handles multiple underscores', () => {
    expect(snakeToCamel('active_user_count')).toBe('activeUserCount');
  });

  it('leaves already-camel unchanged', () => {
    expect(snakeToCamel('totalRevenue')).toBe('totalRevenue');
  });

  it('handles trailing segment with digit', () => {
    expect(snakeToCamel('rev_2024')).toBe('rev2024');
  });
});

describe('adaptName()', () => {
  it('converts snake to camel when convention is camel', () => {
    expect(adaptName('total_revenue', 'camel')).toBe('totalRevenue');
  });

  it('leaves camelCase unchanged when convention is camel', () => {
    expect(adaptName('totalRevenue', 'camel')).toBe('totalRevenue');
  });

  it('leaves snake unchanged when convention is snake', () => {
    expect(adaptName('total_revenue', 'snake')).toBe('total_revenue');
  });

  it('returns name unchanged for snake convention regardless of casing', () => {
    expect(adaptName('totalRevenue', 'snake')).toBe('totalRevenue');
  });
});
