/**
 * Compare-surface components: Venn radii scale with cohort size (area ∝ size),
 * delta tiles render counts + Jaccard and gate the save button, and the metric
 * table loads region aggregates on demand. Client mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OverlapResponse } from '../../../../api/segment-compare-client';

const regionMetricsMock = vi.fn();
vi.mock('../../../../api/segment-compare-client', () => ({
  segmentCompareClient: { regionMetrics: (...a: unknown[]) => regionMetricsMock(...a) },
}));
vi.mock('../../../../api/api-client', () => ({
  SegmentApiError: class extends Error {},
}));

import { OverlapVenn } from '../overlap-venn';
import { RegionDeltaTiles } from '../region-delta-tiles';
import { RegionMetricTable } from '../region-metric-table';

const data: OverlapResponse = {
  a: { id: 'a', name: 'Whales', snapshot_ts: null, snapshot_date: '2026-06-21', stale: false, has_snapshot: true },
  b: { id: 'b', name: 'Churned', snapshot_ts: null, snapshot_date: '2026-06-21', stale: false, has_snapshot: true },
  game_id: 'cfm_vn',
  a_size: 400, b_size: 100, a_only: 380, both: 20, b_only: 80, jaccard: 20 / 460,
};

describe('OverlapVenn', () => {
  it('scales radius with sqrt(size) — 4× size ⇒ 2× radius', () => {
    const { container } = render(
      <OverlapVenn aSize={400} bSize={100} both={20} aLabel="A" bLabel="B" />,
    );
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2);
    const rA = Number(circles[0].getAttribute('r'));
    const rB = Number(circles[1].getAttribute('r'));
    expect(rA / rB).toBeCloseTo(2, 1);
  });

  it('renders the overlap count when both > 0', () => {
    render(<OverlapVenn aSize={400} bSize={100} both={20} aLabel="A" bLabel="B" />);
    expect(screen.getByText('20')).toBeTruthy();
  });
});

describe('RegionDeltaTiles', () => {
  it('renders region counts + Jaccard and routes save clicks', () => {
    const onSave = vi.fn();
    render(<RegionDeltaTiles data={data} savingRegion={null} onSaveRegion={onSave} />);
    expect(screen.getByText('380')).toBeTruthy(); // a-only
    expect(screen.getByText('80')).toBeTruthy(); // b-only
    expect(screen.getByText('4.3%')).toBeTruthy(); // jaccard = 20/460 ≈ 4.3%
    fireEvent.click(screen.getAllByText('Save as segment')[0]);
    expect(onSave).toHaveBeenCalledWith('aOnly');
  });

  it('disables save for an empty region', () => {
    const empty = { ...data, a_only: 0 };
    render(<RegionDeltaTiles data={empty} savingRegion={null} onSaveRegion={vi.fn()} />);
    const buttons = screen.getAllByText('Save as segment').map((el) => el.closest('button'));
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('RegionMetricTable', () => {
  beforeEach(() => regionMetricsMock.mockReset());

  it('loads region aggregates on demand and renders the measure rows', async () => {
    regionMetricsMock.mockImplementation((_a, _b, region) =>
      Promise.resolve({
        region,
        member_count: 10,
        metrics: {
          sampleSize: 10,
          sampled: false,
          measures: [{ concept: 'spend', label: 'Lifetime spend', currency: 'vnd', avg: 1000, median: 800, count: 10 }],
        },
      }),
    );
    render(<RegionMetricTable data={data} />);
    fireEvent.click(screen.getByText('Load region metrics'));
    await waitFor(() => expect(screen.getByText('Lifetime spend')).toBeTruthy());
    expect(regionMetricsMock).toHaveBeenCalledTimes(3); // one per region
    expect(screen.getAllByText('1,000₫').length).toBeGreaterThan(0);
  });

  it('discloses when a region was sampled', async () => {
    regionMetricsMock.mockResolvedValue({
      region: 'aOnly', member_count: 99999,
      metrics: { sampleSize: 1000, sampled: true, measures: [{ concept: 'spend', label: 'Lifetime spend', currency: null, avg: 5, median: 5, count: 1000 }] },
    });
    render(<RegionMetricTable data={data} />);
    fireEvent.click(screen.getByText('Load region metrics'));
    await waitFor(() => expect(screen.getByText(/estimated from a sample/i)).toBeTruthy());
  });
});
