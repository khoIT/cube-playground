/**
 * Tests for AssistantChartSection.
 *
 * Recharts uses ResponsiveContainer, which reports 0×0 in jsdom because there
 * are no real layout boxes. recharts skips rendering inner chart when width is
 * 0, so we wrap with an explicit width to coax it into mounting.
 *
 * We assert: title renders, truncation footer renders, no crash on multiple
 * chart types.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssistantChartSection, scatterLabelKey } from '../components/assistant-chart-section';
import {
  toCsv,
  compatibleChartTypes,
  canDualAxis,
  isNumericColumn,
  numericColumns,
  toDualAxisSpec,
  toScatterSpec,
} from '../components/chart-section-menu';
import type { ChartArtifact, ChartSpec } from '../../../api/chat-sse-client';

// recharts uses ResizeObserver internally — stub it for jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

function makeArtifact(overrides: Partial<ChartArtifact> = {}): ChartArtifact {
  return {
    id: 'c-1',
    truncated: false,
    originalRowCount: 3,
    spec: {
      type: 'stacked-bar',
      title: 'Revenue by group/channel',
      data: [
        { group: 'Web', channel: 'a', revenue: 200 },
        { group: 'Web', channel: 'b', revenue: 150 },
        { group: 'IAP', channel: 'appstore', revenue: 300 },
      ],
      encoding: { category: 'group', value: 'revenue', series: 'channel' },
    },
    ...overrides,
  };
}

function renderWithWidth(node: React.ReactNode) {
  return render(<div style={{ width: 600 }}>{node}</div>);
}

describe('AssistantChartSection', () => {
  it('renders the chart title when not embedded', () => {
    renderWithWidth(<AssistantChartSection artifact={makeArtifact()} />);
    expect(screen.getByText('Revenue by group/channel')).toBeTruthy();
  });

  it('suppresses the title when embedded=true', () => {
    renderWithWidth(<AssistantChartSection artifact={makeArtifact()} embedded />);
    expect(screen.queryByText('Revenue by group/channel')).toBeNull();
  });

  it('renders the truncation footer when truncated=true', () => {
    const artifact = makeArtifact({
      truncated: true,
      originalRowCount: 50,
      spec: {
        type: 'bar',
        title: 'Top regions',
        data: Array.from({ length: 30 }, (_, i) => ({
          region: i < 29 ? `R${i}` : 'Other',
          revenue: 100 - i,
        })),
        encoding: { category: 'region', value: 'revenue' },
      },
    });
    renderWithWidth(<AssistantChartSection artifact={artifact} />);
    expect(screen.getByText(/Showing top 29 of 50/i)).toBeTruthy();
  });

  it('renders caption when provided', () => {
    const artifact = makeArtifact({
      spec: {
        type: 'pie',
        title: 'Split',
        caption: 'May 2026, by group',
        data: [
          { k: 'Web', v: 60 },
          { k: 'IAP', v: 40 },
        ],
        encoding: { category: 'k', value: 'v' },
      },
    });
    renderWithWidth(<AssistantChartSection artifact={artifact} />);
    expect(screen.getByText('May 2026, by group')).toBeTruthy();
  });

  it('does not crash on each of the chart types', () => {
    const baseEnc = { category: 'k', value: 'v' };
    const seriesEnc = { ...baseEnc, series: 's' };
    const data2 = [
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
    ];
    const seriesData = [
      { k: 'a', s: 'x', v: 1 },
      { k: 'a', s: 'y', v: 2 },
      { k: 'b', s: 'x', v: 3 },
    ];

    const variants: Array<Pick<ChartArtifact['spec'], 'type' | 'data' | 'encoding' | 'title'>> = [
      { type: 'bar', title: 't', data: data2, encoding: baseEnc },
      { type: 'horizontal-bar', title: 't', data: data2, encoding: baseEnc },
      { type: 'line', title: 't', data: data2, encoding: baseEnc },
      { type: 'area', title: 't', data: data2, encoding: baseEnc },
      { type: 'scatter', title: 't', data: data2, encoding: baseEnc },
      { type: 'pie', title: 't', data: data2, encoding: baseEnc },
      { type: 'donut', title: 't', data: data2, encoding: baseEnc },
      { type: 'stacked-bar', title: 't', data: seriesData, encoding: seriesEnc },
      { type: 'multi-line', title: 't', data: seriesData, encoding: seriesEnc },
      { type: 'heatmap', title: 't', data: seriesData, encoding: seriesEnc },
    ];

    for (const v of variants) {
      const artifact: ChartArtifact = {
        id: `c-${v.type}`,
        truncated: false,
        originalRowCount: v.data.length,
        spec: v as ChartArtifact['spec'],
      };
      const { unmount } = renderWithWidth(<AssistantChartSection artifact={artifact} />);
      unmount();
    }
  });

  it('renders heatmap cells with values (plain CSS grid, jsdom-visible)', () => {
    const artifact = makeArtifact({
      spec: {
        type: 'heatmap',
        title: 'Sessions by day × hour',
        data: [
          { hour: 0, dow: 'Mon', sessions: 12 },
          { hour: 1, dow: 'Mon', sessions: 5 },
          { hour: 0, dow: 'Tue', sessions: 9 },
        ],
        encoding: { category: 'hour', value: 'sessions', series: 'dow' },
      },
    });
    renderWithWidth(<AssistantChartSection artifact={artifact} />);
    // Row labels (y axis) and a cell value render as real text nodes.
    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('Tue')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    // Heatmaps default to chart view, not the data table.
    expect(screen.getAllByRole('cell').length).toBeGreaterThan(0);
  });

  it('view-switcher toggles between chart and data-table views', () => {
    const artifact = makeArtifact({
      spec: {
        type: 'bar',
        title: 'Channels',
        data: [
          { channel: 'Facebook', cpi: 5.1 },
          { channel: 'Vungle', cpi: 2.0 },
        ],
        encoding: { category: 'channel', value: 'cpi' },
      },
    });
    renderWithWidth(<AssistantChartSection artifact={artifact} />);

    // Open menu, switch to data table.
    fireEvent.click(screen.getByTestId('chart-section-menu-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: /data table/i }));

    expect(screen.getByText('Facebook')).toBeTruthy();
    expect(screen.getByText('Vungle')).toBeTruthy();

    // Switch back to chart.
    fireEvent.click(screen.getByTestId('chart-section-menu-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: /show chart/i }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Export CSV triggers a download with the slugified title', () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => {
      const fake = `blob:fake-${created.length}`;
      created.push(fake);
      return fake;
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u); }) as unknown as typeof URL.revokeObjectURL;

    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      const artifact = makeArtifact({
        spec: {
          type: 'bar',
          title: 'CPI vs LTV',
          data: [{ c: 'a', v: 1 }],
          encoding: { category: 'c', value: 'v' },
        },
      });
      renderWithWidth(<AssistantChartSection artifact={artifact} />);
      fireEvent.click(screen.getByTestId('chart-section-menu-trigger'));
      fireEvent.click(screen.getByRole('menuitem', { name: /export csv/i }));

      expect(created.length).toBe(1);
      expect(anchorClick).toHaveBeenCalledTimes(1);
      expect(revoked).toEqual(created);
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      anchorClick.mockRestore();
    }
  });
});

describe('toCsv', () => {
  it('quotes cells with commas, quotes, or newlines', () => {
    const csv = toCsv([
      { a: 'hi', b: 'with,comma', c: 'with"quote', d: 'with\nnewline' },
    ]);
    // Header + body (body contains an embedded newline inside a quoted cell).
    expect(csv).toBe('a,b,c,d\nhi,"with,comma","with""quote","with\nnewline"');
  });

  it('emits header even on empty data only when rows exist', () => {
    expect(toCsv([])).toBe('');
    const out = toCsv([{ x: 1, y: 2 }]);
    expect(out.startsWith('x,y\n')).toBe(true);
    expect(out).toContain('1,2');
  });
});

describe('compatibleChartTypes', () => {
  function spec(partial: Partial<ChartSpec>): ChartSpec {
    return {
      type: 'bar',
      title: 't',
      data: [],
      encoding: { category: 'c', value: 'v' },
      ...partial,
    } as ChartSpec;
  }

  it('series-encoded → grouped-bar + stacked-bar + multi-line + heatmap', () => {
    expect(compatibleChartTypes(spec({
      type: 'stacked-bar',
      encoding: { category: 'c', value: 'v', series: 's' },
    }))).toEqual(['grouped-bar', 'stacked-bar', 'multi-line', 'heatmap']);
  });

  it('category×value with few slices → full set incl pie/donut', () => {
    const rows = [{ c: 'a', v: 1 }, { c: 'b', v: 2 }];
    expect(compatibleChartTypes(spec({ type: 'pie', data: rows }))).toEqual([
      'bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut',
    ]);
    expect(compatibleChartTypes(spec({ type: 'bar', data: rows }))).toEqual([
      'bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut',
    ]);
  });

  it('category×value with many rows → no pie/donut', () => {
    // Non-numeric category (region labels) so this isolates the pie/donut
    // slice-count threshold, not scatter eligibility.
    const rows = Array.from({ length: 13 }, (_, i) => ({ c: `R${i}`, v: i }));
    expect(compatibleChartTypes(spec({ type: 'bar', data: rows }))).toEqual([
      'bar', 'horizontal-bar', 'line', 'area',
    ]);
  });

  it('scatter is standalone when there is no dual-axis-capable shape', () => {
    expect(compatibleChartTypes(spec({ type: 'scatter' }))).toEqual(['scatter']);
  });

  it('scatter with 1 category + 2 metrics also offers dual-axis', () => {
    const rows = [
      { country: 'VN', arpu_vnd: 7657, paying_rate: 0.0069 },
      { country: 'SG', arpu_vnd: 2224, paying_rate: 0.0044 },
    ];
    expect(compatibleChartTypes(spec({
      type: 'scatter', data: rows, encoding: { category: 'arpu_vnd', value: 'paying_rate' },
    }))).toEqual(['scatter', 'dual-axis']);
  });

  it('funnel is standalone', () => {
    expect(compatibleChartTypes(spec({ type: 'funnel' }))).toEqual(['funnel']);
  });

  it('default single-series → bar/horizontal-bar/line/area', () => {
    expect(compatibleChartTypes(spec({ type: 'bar' }))).toEqual([
      'bar', 'horizontal-bar', 'line', 'area',
    ]);
  });

  it('category×value with ≥2 numeric columns → offers scatter + dual-axis', () => {
    // One categorical (country) + two metrics → correlation (scatter) and a
    // bars+line combo (dual-axis) both become viewable.
    const rows = [
      { country: 'VN', arpu_vnd: 7657, paying_rate: 0.12 },
      { country: 'SG', arpu_vnd: 2224, paying_rate: 0.08 },
    ];
    expect(compatibleChartTypes(spec({
      type: 'bar', data: rows, encoding: { category: 'country', value: 'arpu_vnd' },
    }))).toEqual(['bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'scatter', 'dual-axis']);
  });

  it('category×value with a single numeric column → no scatter', () => {
    const rows = [{ country: 'VN', arpu_vnd: 7657 }, { country: 'SG', arpu_vnd: 2224 }];
    expect(compatibleChartTypes(spec({
      type: 'bar', data: rows, encoding: { category: 'country', value: 'arpu_vnd' },
    }))).not.toContain('scatter');
  });
});

describe('numeric-column helpers', () => {
  const rows = [
    { country: 'VN', arpu_vnd: 7657, paying_rate: '0.12' },
    { country: 'SG', arpu_vnd: 2224, paying_rate: '0.08' },
  ];

  it('isNumericColumn detects numbers and numeric strings, rejects labels', () => {
    expect(isNumericColumn(rows, 'arpu_vnd')).toBe(true);
    expect(isNumericColumn(rows, 'paying_rate')).toBe(true); // numeric strings
    expect(isNumericColumn(rows, 'country')).toBe(false);
    expect(isNumericColumn([], 'arpu_vnd')).toBe(false);
  });

  it('numericColumns lists only the all-numeric columns', () => {
    expect(numericColumns(rows)).toEqual(['arpu_vnd', 'paying_rate']);
    expect(numericColumns([])).toEqual([]);
  });
});

describe('toScatterSpec', () => {
  it('keeps the charted value as one axis and picks another numeric for the other', () => {
    const out = toScatterSpec({
      type: 'bar',
      title: 'ARPU vs paying-rate per country',
      data: [
        { country: 'VN', arpu_vnd: 7657, paying_rate: 0.12 },
        { country: 'SG', arpu_vnd: 2224, paying_rate: 0.08 },
      ],
      encoding: { category: 'country', value: 'arpu_vnd' },
    } as ChartSpec);
    expect(out.type).toBe('scatter');
    expect(out.encoding.value).toBe('arpu_vnd'); // originally-charted metric kept as an axis
    expect(out.encoding.category).toBe('paying_rate'); // the other numeric column
    // The entity column survives in the rows so the renderer can label points.
    expect(scatterLabelKey(out.data, out.encoding)).toBe('country');
  });
});

describe('toDualAxisSpec / canDualAxis', () => {
  const mk = (partial: Partial<ChartSpec>): ChartSpec =>
    ({ type: 'bar', title: 't', data: [], encoding: { category: 'c', value: 'v' }, ...partial } as ChartSpec);
  const rows = [
    { country: 'VN', arpu_vnd: 7657, paying_rate: 0.0069 },
    { country: 'SG', arpu_vnd: 2224, paying_rate: 0.0044 },
  ];

  it('encodes category=entity, value=first metric (bars), series=second metric (line)', () => {
    const out = toDualAxisSpec(mk({
      type: 'scatter', data: rows, encoding: { category: 'arpu_vnd', value: 'paying_rate' },
    }));
    expect(out.type).toBe('dual-axis');
    expect(out.encoding.category).toBe('country');
    expect(out.encoding.value).toBe('arpu_vnd');   // left axis / bars
    expect(out.encoding.series).toBe('paying_rate'); // right axis / line
  });

  it('canDualAxis requires a category column and ≥2 numeric columns', () => {
    expect(canDualAxis(mk({ data: rows, encoding: { category: 'country', value: 'arpu_vnd' } }))).toBe(true);
    expect(canDualAxis(mk({ data: [{ country: 'VN', arpu_vnd: 1 }], encoding: { category: 'country', value: 'arpu_vnd' } }))).toBe(false); // 1 metric
    expect(canDualAxis(mk({ data: [{ a: 1, b: 2 }], encoding: { category: 'a', value: 'b' } }))).toBe(false); // no categorical column
    expect(canDualAxis(mk({ encoding: { category: 'c', value: 'v', series: 's' } }))).toBe(false); // series-encoded
  });

  it('renders without crashing', () => {
    const artifact = makeArtifact({
      spec: toDualAxisSpec(mk({
        type: 'scatter', title: 'ARPU vs paying-rate', data: rows,
        encoding: { category: 'arpu_vnd', value: 'paying_rate' },
      })),
    });
    const { unmount } = renderWithWidth(<AssistantChartSection artifact={artifact} />);
    unmount();
  });
});

describe('scatterLabelKey', () => {
  it('picks the leftover entity column ("ARPU vs paying-rate per country")', () => {
    const rows = [
      { country: 'VN', arpu_vnd: 7657, paying_rate: 0.12 },
      { country: 'SG', arpu_vnd: 2224, paying_rate: 0.08 },
    ];
    expect(scatterLabelKey(rows, { category: 'arpu_vnd', value: 'paying_rate' })).toBe('country');
  });

  it('returns undefined when rows carry only the two axis columns', () => {
    const rows = [{ x: 1, y: 2 }];
    expect(scatterLabelKey(rows, { category: 'x', value: 'y' })).toBeUndefined();
  });

  it('does not throw on empty data', () => {
    expect(scatterLabelKey([], { category: 'x', value: 'y' })).toBeUndefined();
  });

  it('prefers the non-numeric leftover when extra numeric columns are present', () => {
    // user_count is numeric leftover; country is the real entity label.
    const rows = [
      { user_count: 1000, country: 'VN', arpu_vnd: 7657, paying_rate: 0.12 },
      { user_count: 800, country: 'SG', arpu_vnd: 2224, paying_rate: 0.08 },
    ];
    expect(scatterLabelKey(rows, { category: 'arpu_vnd', value: 'paying_rate' })).toBe('country');
  });
});
