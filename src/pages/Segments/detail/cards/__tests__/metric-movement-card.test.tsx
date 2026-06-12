/**
 * MetricMovementCard — registry-gated visibility (no eligible metrics → no
 * card), lens-tab switching with anchor requirement, survivor-bias labelling
 * on stayers, join-warning surface, sparse-empty state. apiFetch mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Segment } from '../../../../../types/segment-api';

const apiFetchMock = vi.fn();
vi.mock('../../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { MetricMovementCard } from '../metric-movement-card';

const seg = { id: 's1', type: 'predicate', game_id: 'cfm_vn', name: 'whales' } as unknown as Segment;

const METRICS = { metrics: [
  { metricKey: 'revenue', label: 'Revenue (VND)', unit: 'VND' },
  { metricKey: 'active_members', label: 'Active members', unit: 'members' },
] };

function seriesPayload(over: Record<string, unknown> = {}) {
  return {
    points: [
      { date: '2026-06-10', value: 173015000, memberCount: 3968 },
      { date: '2026-06-12', value: 331342000, memberCount: 3969 },
    ],
    joinWarning: null,
    metric: 'revenue',
    label: 'Revenue (VND)',
    unit: 'VND',
    lens: 'current',
    anchor: null,
    survivorBiased: false,
    ...over,
  };
}

function routeMock(series: unknown = seriesPayload()) {
  apiFetchMock.mockImplementation((url: string) =>
    url.includes('eligible-metrics') ? Promise.resolve(METRICS) : Promise.resolve(series),
  );
}

beforeEach(() => {
  apiFetchMock.mockReset();
  routeMock();
});

describe('<MetricMovementCard />', () => {
  it('renders lens tabs with their semantics and loads the current-lens series', async () => {
    render(<MetricMovementCard segment={seg} />);
    await waitFor(() => expect(screen.getByText('Current members')).toBeTruthy());
    expect(screen.getByText(/composition moves it/)).toBeTruthy();
    expect(screen.getByText(/causal lens/)).toBeTruthy();
    expect(screen.getByText(/survivor-biased by construction/)).toBeTruthy();
    const seriesCall = apiFetchMock.mock.calls.find((c) => String(c[0]).includes('metric-series'));
    expect(String(seriesCall![0])).toContain('lens=current');
    expect(String(seriesCall![0])).not.toContain('anchor');
  });

  it('hides entirely when the game has no registry-eligible metrics', async () => {
    apiFetchMock.mockImplementation((url: string) =>
      url.includes('eligible-metrics') ? Promise.resolve({ metrics: [] }) : Promise.resolve(seriesPayload()),
    );
    const { container } = render(<MetricMovementCard segment={seg} />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('switching to stayers sends an anchor and shows the survivor-bias banner', async () => {
    routeMock(seriesPayload({ lens: 'stayers', survivorBiased: true }));
    render(<MetricMovementCard segment={seg} />);
    await waitFor(() => expect(screen.getByText(/Stayers/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Stayers/));
    await waitFor(() => expect(screen.getByText(/Survivor-biased:/)).toBeTruthy());
    const stayersCall = apiFetchMock.mock.calls.find((c) => String(c[0]).includes('lens=stayers'));
    expect(String(stayersCall![0])).toMatch(/anchor=\d{4}-\d{2}-\d{2}/);
  });

  it('surfaces the reader join warning', async () => {
    routeMock(seriesPayload({ joinWarning: 'metric-series join matched 0 mart rows…' }));
    render(<MetricMovementCard segment={seg} />);
    await waitFor(() => expect(screen.getByText(/matched 0 mart rows/)).toBeTruthy());
  });

  it('shows the sparse-tolerant empty state for zero points', async () => {
    routeMock(seriesPayload({ points: [] }));
    render(<MetricMovementCard segment={seg} />);
    await waitFor(() => expect(screen.getByText(/sparse days are normal/)).toBeTruthy());
  });

  it('renders nothing for manual segments without fetching', () => {
    const { container } = render(
      <MetricMovementCard segment={{ ...seg, type: 'manual' } as Segment} />,
    );
    expect(container.firstChild).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
