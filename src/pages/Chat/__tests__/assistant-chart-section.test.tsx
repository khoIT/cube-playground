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
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssistantChartSection } from '../components/assistant-chart-section';
import type { ChartArtifact } from '../../../api/chat-sse-client';

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
});
