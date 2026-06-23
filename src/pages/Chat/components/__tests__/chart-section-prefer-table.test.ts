import { describe, it, expect } from 'vitest';
import { preferTableView } from '../chart-section-menu';
import type { ChartSpec } from '../../../../api/chat-sse-client';

function spec(rows: Array<Record<string, string | number>>): ChartSpec {
  return { type: 'bar', title: 't', data: rows, encoding: { category: 'a', value: 'b' } };
}

describe('preferTableView', () => {
  it('chart-first for a small, narrow categorical result', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ a: `c${i}`, b: i }));
    expect(preferTableView(spec(rows))).toBe(false);
  });

  it('table-first for a high-cardinality leaderboard (> 12 rows)', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ a: `u${i}`, b: i }));
    expect(preferTableView(spec(rows))).toBe(true);
  });

  it('table-first for a wide result (>= 4 columns)', () => {
    const rows = [{ a: 'x', b: 1, c: 2, d: 3 }];
    expect(preferTableView(spec(rows))).toBe(true);
  });

  it('tolerates empty data', () => {
    expect(preferTableView(spec([]))).toBe(false);
  });

  it('chart-first for heatmap even with many (cell) rows', () => {
    const rows = Array.from({ length: 168 }, (_, i) => ({
      hour: i % 24,
      dow: `D${Math.floor(i / 24)}`,
      sessions: i,
    }));
    const heatmap: ChartSpec = {
      type: 'heatmap',
      title: 't',
      data: rows,
      encoding: { category: 'hour', value: 'sessions', series: 'dow' },
    };
    expect(preferTableView(heatmap)).toBe(false);
  });

  it('chart-first for a long time-series trend (line/area open as the chart)', () => {
    // A 30-day daily series trips the >12-row leaderboard rule, but a trend IS
    // the chart — opening it as a 30-row table buries the shape.
    const rows = Array.from({ length: 30 }, (_, i) => ({ log_date: `2026-06-${i + 1}`, revenue: i }));
    for (const type of ['line', 'area', 'multi-line', 'dual-axis'] as const) {
      expect(preferTableView({ ...spec(rows), type })).toBe(false);
    }
  });

  it('still table-first for a long bar leaderboard (not a trend type)', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ a: `u${i}`, b: i }));
    expect(preferTableView({ ...spec(rows), type: 'bar' })).toBe(true);
    expect(preferTableView({ ...spec(rows), type: 'horizontal-bar' })).toBe(true);
  });
});
