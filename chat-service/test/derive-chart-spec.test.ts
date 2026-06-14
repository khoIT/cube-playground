import { describe, it, expect } from 'vitest';
import { deriveChartSpec } from '../src/services/derive-chart-spec.js';

const day = 'billing_detail.order_date.day';
const cash = 'billing_detail.cash_charged_gross';
const gw = 'billing_detail.payment_gateway';

describe('deriveChartSpec', () => {
  it('time dimension only → line', () => {
    const rows = [
      { [day]: '2026-06-01T00:00:00.000', [cash]: 100 },
      { [day]: '2026-06-02T00:00:00.000', [cash]: 200 },
    ];
    const spec = deriveChartSpec(
      { measures: [cash], timeDimensions: [{ dimension: 'billing_detail.order_date', granularity: 'day' }] },
      rows,
    );
    expect(spec?.type).toBe('line');
    expect(spec?.encoding).toEqual({ category: day, value: cash });
  });

  it('time dimension + non-time dimension → multi-line', () => {
    const rows = [
      { [day]: '2026-06-01T00:00:00.000', [gw]: 'Apple', [cash]: 100 },
      { [day]: '2026-06-01T00:00:00.000', [gw]: 'Google', [cash]: 50 },
    ];
    const spec = deriveChartSpec(
      {
        measures: [cash],
        dimensions: [gw],
        timeDimensions: [{ dimension: 'billing_detail.order_date', granularity: 'day' }],
      },
      rows,
    );
    expect(spec?.type).toBe('multi-line');
    expect(spec?.encoding).toEqual({ category: day, value: cash, series: gw });
  });

  it('one non-time dimension → bar', () => {
    const rows = [
      { [gw]: 'Apple', [cash]: 100 },
      { [gw]: 'Google', [cash]: 50 },
    ];
    const spec = deriveChartSpec({ measures: [cash], dimensions: [gw] }, rows);
    expect(spec?.type).toBe('bar');
    expect(spec?.encoding).toEqual({ category: gw, value: cash });
  });

  it('two non-time dimensions → stacked-bar', () => {
    const country = 'billing_detail.country';
    const rows = [
      { [gw]: 'Apple', [country]: 'VN', [cash]: 100 },
      { [gw]: 'Google', [country]: 'VN', [cash]: 50 },
    ];
    const spec = deriveChartSpec({ measures: [cash], dimensions: [gw, country] }, rows);
    expect(spec?.type).toBe('stacked-bar');
    expect(spec?.encoding).toEqual({ category: gw, value: cash, series: country });
  });

  it('measures-only (no dimension) → null (skip)', () => {
    const rows = [{ [cash]: 1000 }];
    expect(deriveChartSpec({ measures: [cash] }, rows)).toBeNull();
  });

  it('no rows → null', () => {
    expect(deriveChartSpec({ measures: [cash], dimensions: [gw] }, [])).toBeNull();
  });

  it('no measures → null', () => {
    const rows = [{ [gw]: 'Apple' }];
    expect(deriveChartSpec({ dimensions: [gw] }, rows)).toBeNull();
  });

  it('caps rows at the schema max (100)', () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ [gw]: `g${i}`, [cash]: i }));
    const spec = deriveChartSpec({ measures: [cash], dimensions: [gw] }, rows);
    expect(spec).not.toBeNull();
    expect(spec!.data.length).toBeLessThanOrEqual(100);
  });

  it('encoding columns exist in the data rows', () => {
    const rows = [{ [day]: '2026-06-01T00:00:00.000', [cash]: 1 }];
    const spec = deriveChartSpec(
      { measures: [cash], timeDimensions: [{ dimension: 'billing_detail.order_date', granularity: 'day' }] },
      rows,
    );
    expect(Object.keys(rows[0])).toContain(spec!.encoding.category);
    expect(Object.keys(rows[0])).toContain(spec!.encoding.value);
  });
});
