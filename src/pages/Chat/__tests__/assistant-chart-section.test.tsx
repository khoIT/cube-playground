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
import { AssistantChartSection } from '../components/assistant-chart-section';
import { toCsv, compatibleChartTypes } from '../components/chart-section-menu';
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

  it('does not crash on each of the 9 chart types', () => {
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

  it('series-encoded → grouped-bar + stacked-bar + multi-line', () => {
    expect(compatibleChartTypes(spec({
      type: 'stacked-bar',
      encoding: { category: 'c', value: 'v', series: 's' },
    }))).toEqual(['grouped-bar', 'stacked-bar', 'multi-line']);
  });

  it('pie/donut share a group', () => {
    expect(compatibleChartTypes(spec({ type: 'pie' }))).toEqual(['pie', 'donut']);
    expect(compatibleChartTypes(spec({ type: 'donut' }))).toEqual(['pie', 'donut']);
  });

  it('scatter is standalone', () => {
    expect(compatibleChartTypes(spec({ type: 'scatter' }))).toEqual(['scatter']);
  });

  it('funnel is standalone', () => {
    expect(compatibleChartTypes(spec({ type: 'funnel' }))).toEqual(['funnel']);
  });

  it('default single-series → bar/horizontal-bar/line/area', () => {
    expect(compatibleChartTypes(spec({ type: 'bar' }))).toEqual([
      'bar', 'horizontal-bar', 'line', 'area',
    ]);
  });
});
