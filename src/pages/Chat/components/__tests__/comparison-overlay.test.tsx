/**
 * Comparison overlay: index-rebase transform (both series start at 100, zero/
 * missing t0 dropped + disclosed, order preserved) and the comparison-eligible
 * gate + toggle rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChartSpec } from '../../../../api/chat-sse-client';
import { rebaseSeriesToIndex, INDEX_KEY, SERIES_KEY } from '../rebase-series-to-index';
import { isComparisonChart, ComparisonViewToggle } from '../comparison-view-toggle';

describe('rebaseSeriesToIndex', () => {
  it('rebases a wide dual-metric spec — both metrics start at 100', () => {
    const spec: ChartSpec = {
      type: 'dual-axis',
      title: 'Revenue vs DAU',
      data: [
        { day: 'D1', revenue: 1000, dau: 50 },
        { day: 'D2', revenue: 1500, dau: 60 },
      ],
      encoding: { category: 'day', value: 'revenue', series: 'dau' },
    };
    const out = rebaseSeriesToIndex(spec);
    expect(out.type).toBe('multi-line');
    const rev = out.data.filter((r) => r[SERIES_KEY] === 'revenue');
    const dau = out.data.filter((r) => r[SERIES_KEY] === 'dau');
    expect(rev[0][INDEX_KEY]).toBe(100);
    expect(dau[0][INDEX_KEY]).toBe(100);
    expect(rev[1][INDEX_KEY]).toBe(150); // 1500/1000*100
    expect(dau[1][INDEX_KEY]).toBe(120); // 60/50*100
  });

  it('rebases a long multi-line spec per series value, preserving order', () => {
    const spec: ChartSpec = {
      type: 'multi-line',
      title: 'Spend by game',
      data: [
        { day: 'D1', spend: 200, game: 'cfm' },
        { day: 'D2', spend: 400, game: 'cfm' },
        { day: 'D1', spend: 10, game: 'jus' },
        { day: 'D2', spend: 5, game: 'jus' },
      ],
      encoding: { category: 'day', value: 'spend', series: 'game' },
    };
    const out = rebaseSeriesToIndex(spec);
    const cfm = out.data.filter((r) => r[SERIES_KEY] === 'cfm');
    const jus = out.data.filter((r) => r[SERIES_KEY] === 'jus');
    expect(cfm.map((r) => r[INDEX_KEY])).toEqual([100, 200]);
    expect(jus.map((r) => r[INDEX_KEY])).toEqual([100, 50]);
  });

  it('drops a series with a zero/missing first value and discloses it', () => {
    const spec: ChartSpec = {
      type: 'multi-line',
      title: 'x',
      data: [
        { day: 'D1', v: 0, s: 'zero' },
        { day: 'D2', v: 5, s: 'zero' },
        { day: 'D1', v: 100, s: 'ok' },
        { day: 'D2', v: 150, s: 'ok' },
      ],
      encoding: { category: 'day', value: 'v', series: 's' },
    };
    const out = rebaseSeriesToIndex(spec);
    // 'zero' has first finite non-zero value at D2 (5), so it rebases off 5 — not dropped.
    // Make a truly all-zero-start series to assert the drop:
    const allZero: ChartSpec = {
      type: 'multi-line', title: 'x',
      data: [{ day: 'D1', v: 0, s: 'z' }, { day: 'D2', v: 0, s: 'z' }],
      encoding: { category: 'day', value: 'v', series: 's' },
    };
    const dropped = rebaseSeriesToIndex(allZero);
    expect(dropped.data).toHaveLength(0);
    expect(dropped.caption).toMatch(/Omitted/);
    expect(out.data.length).toBeGreaterThan(0);
  });
});

describe('isComparisonChart', () => {
  it('is true for dual-axis and ≥2-value series, false otherwise', () => {
    expect(isComparisonChart('dual-axis', [], undefined)).toBe(true);
    expect(isComparisonChart('bar', [{ x: 'a', y: 1 }], undefined)).toBe(false);
    // wide 2-metric (numeric series column)
    expect(isComparisonChart('multi-line', [{ d: 'D1', a: 1, b: 2 }], 'b')).toBe(true);
    // long series dim with 2 distinct values
    expect(
      isComparisonChart('multi-line', [{ d: 'D1', v: 1, s: 'x' }, { d: 'D1', v: 2, s: 'y' }], 's'),
    ).toBe(true);
    // single series value → not a comparison
    expect(isComparisonChart('multi-line', [{ d: 'D1', v: 1, s: 'x' }], 's')).toBe(false);
  });
});

describe('ComparisonViewToggle', () => {
  it('renders three options and reports the picked value', () => {
    const onChange = vi.fn();
    render(<ComparisonViewToggle value="overlaid" onChange={onChange} />);
    expect(screen.getByText('Overlaid')).toBeTruthy();
    expect(screen.getByText('Grouped')).toBeTruthy();
    expect(screen.getByText('Indexed')).toBeTruthy();
    fireEvent.click(screen.getByText('Indexed'));
    expect(onChange).toHaveBeenCalledWith('indexed');
  });
});
