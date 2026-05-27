import { describe, it, expect } from 'vitest';
import type { ChartSpec } from '../../../../api/chat-sse-client';
import {
  detectChartUnit,
  detectColumnUnit,
  detectPercentScale,
  formatAxisValue,
  formatReadableValue,
} from '../format-chart-value';

const baseSpec: ChartSpec = {
  type: 'bar',
  title: '',
  data: [],
  encoding: { category: 'x', value: 'y' },
};

describe('detectChartUnit', () => {
  it('picks vnd from title', () => {
    expect(detectChartUnit({ ...baseSpec, title: 'Daily Revenue (VND) — Last 7 Days' })).toBe(
      'vnd',
    );
  });

  it('picks vnd from column name', () => {
    expect(
      detectChartUnit({
        ...baseSpec,
        title: 'Revenue Split',
        encoding: { category: 'channel', value: 'revenue_vnd' },
      }),
    ).toBe('vnd');
  });

  it('picks percent from column name', () => {
    expect(
      detectChartUnit({
        ...baseSpec,
        title: 'Retention by day',
        encoding: { category: 'day', value: 'd7_rate' },
      }),
    ).toBe('percent');
  });

  it('falls back to unknown when no cues', () => {
    expect(detectChartUnit({ ...baseSpec, title: 'Daily DAU', encoding: { category: 'd', value: 'dau' } })).toBe(
      'unknown',
    );
  });

  it('ignores % inside the caption — caption prose is not a unit declaration', () => {
    expect(
      detectChartUnit({
        ...baseSpec,
        title: 'DAU Daily Trend (Apr 27 – May 26)',
        caption: 'Spike of ~+47% visible around May 15–17',
        encoding: { category: 'date', value: 'DAU' },
      }),
    ).toBe('unknown');
  });

  it('still picks percent when title declares (%)', () => {
    expect(
      detectChartUnit({
        ...baseSpec,
        title: 'D7 Retention (%)',
        encoding: { category: 'cohort', value: 'value' },
      }),
    ).toBe('percent');
  });

  it('still picks percent when title uses the word "percent"', () => {
    expect(
      detectChartUnit({
        ...baseSpec,
        title: 'Conversion percent by channel',
        encoding: { category: 'channel', value: 'value' },
      }),
    ).toBe('percent');
  });

  it('ignores a bare % in the title (e.g. "+47% MoM")', () => {
    expect(
      detectChartUnit({
        ...baseSpec,
        title: 'Revenue +47% MoM',
        encoding: { category: 'month', value: 'revenue' },
      }),
    ).toBe('unknown');
  });
});

describe('detectColumnUnit', () => {
  it('vnd column wins over neutral chart title', () => {
    expect(detectColumnUnit('revenue_vnd', { ...baseSpec, title: 'Trends' })).toBe('vnd');
  });

  it('inherits chart unit when column is neutral', () => {
    expect(
      detectColumnUnit('amount', { ...baseSpec, title: 'Revenue (VND)' }),
    ).toBe('vnd');
  });
});

describe('formatAxisValue', () => {
  it('compacts vnd to B/M without unit suffix', () => {
    expect(formatAxisValue(5_262_027_000, 'vnd')).toBe('5.3B');
    expect(formatAxisValue(314_982_000, 'vnd')).toBe('315M');
  });

  it('compacts percent with % suffix', () => {
    expect(formatAxisValue(42.5, 'percent')).toBe('42.5%');
  });

  it('compacts usd with $ prefix', () => {
    expect(formatAxisValue(1_500, 'usd')).toBe('$1.5K');
  });

  it('count uses compact notation', () => {
    expect(formatAxisValue(16_424, 'count')).toBe('16.4K');
  });
});

describe('formatReadableValue', () => {
  it('vnd over 10k uses M/B suffix with unit', () => {
    expect(formatReadableValue(314_982_000, 'vnd')).toBe('314.98M VND');
    expect(formatReadableValue(5_262_027_000, 'vnd')).toBe('5.26B VND');
  });

  it('vnd under 10k stays thousand-separated', () => {
    expect(formatReadableValue(4_500, 'vnd')).toBe('4,500 VND');
  });

  it('count uses thousand separators', () => {
    expect(formatReadableValue(16_424, 'count')).toBe('16,424');
  });

  it('unknown unit falls back to thousand-sep', () => {
    expect(formatReadableValue(16_424, 'unknown')).toBe('16,424');
  });

  it('percent appends %', () => {
    expect(formatReadableValue(12.3, 'percent')).toBe('12.3%');
  });

  it('passes through non-numeric values unchanged', () => {
    expect(formatReadableValue('N/A', 'vnd')).toBe('N/A');
  });
});

describe('detectPercentScale', () => {
  it('returns 100 when every value is a fraction (|v| <= 1)', () => {
    expect(detectPercentScale([0.0069, 0.0044, 0.00189])).toBe(100);
    expect(detectPercentScale([1, 0.5, '0.25'])).toBe(100);
  });

  it('returns 1 when any value exceeds 1 (already in percent units)', () => {
    expect(detectPercentScale([42.5, 30, 12.3])).toBe(1);
    expect(detectPercentScale([0.5, 1.5])).toBe(1);
  });

  it('defaults to 1 for empty / all-null input', () => {
    expect(detectPercentScale([])).toBe(1);
    expect(detectPercentScale(['x', 'N/A'])).toBe(1);
  });
});

describe('percent scaling + adaptive precision', () => {
  it('scales fractional paying-rate to a legible percent instead of 0%', () => {
    // The reported bug: 0.0069 rendered as "0%". With scale 100 it reads 0.69%.
    expect(formatAxisValue(0.00694, 'percent', 100)).toBe('0.69%');
    expect(formatAxisValue(0.0044, 'percent', 100)).toBe('0.44%');
    expect(formatReadableValue(0.00189, 'percent', 100)).toBe('0.19%');
  });

  it('keeps more decimals for small magnitudes, fewer for large', () => {
    expect(formatAxisValue(0.425, 'percent', 100)).toBe('42.5%'); // >=10 → 1 dp
    expect(formatAxisValue(0.044, 'percent', 100)).toBe('4.4%'); // >=1 → 1 dp
    expect(formatAxisValue(1.2, 'percent', 100)).toBe('120%'); // >=100 → 0 dp
  });

  it('default scale (1) preserves already-scaled percents', () => {
    expect(formatAxisValue(42.5, 'percent')).toBe('42.5%');
    expect(formatReadableValue(12.3, 'percent')).toBe('12.3%');
  });
});
