/**
 * TrajectoryCard — model semantics (gap stitching, stat derivations) and the
 * render branches: data / empty (no snapshots) / error / hidden for manual or
 * game-less segments. apiFetch mocked — endpoint behavior is covered by the
 * server route tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Segment } from '../../../../../types/segment-api';
import {
  buildTrajectoryModel,
  fmtCompact,
  type TrajectoryPayload,
} from '../trajectory-card-model';

const apiFetchMock = vi.fn();
vi.mock('../../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { TrajectoryCard } from '../trajectory-card';

function payload(over: Partial<TrajectoryPayload> = {}): TrajectoryPayload {
  return {
    segmentId: 's1',
    gameId: 'cfm_vn',
    days: 90,
    size: [
      { date: '2026-06-10', members: 7_162_908 },
      { date: '2026-06-12', members: 7_174_638 },
    ],
    delta: [
      { date: '2026-06-10', entered: 7_162_908, exited: 0 },
      { date: '2026-06-12', entered: 38_200, exited: 26_500 },
    ],
    empty: false,
    ...over,
  };
}

const seg = (over: Partial<Segment> = {}): Segment =>
  ({ id: 's1', type: 'predicate', game_id: 'cfm_vn', name: 'whales' } as unknown as Segment);

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue(payload());
});

describe('buildTrajectoryModel', () => {
  it('stitches a continuous domain and counts missed nights as gaps', () => {
    const m = buildTrajectoryModel(payload())!;
    expect(m.days.map((d) => d.date)).toEqual(['2026-06-10', '2026-06-11', '2026-06-12']);
    expect(m.gapCount).toBe(1);
    expect(m.days[1].members).toBeNull(); // gap, never interpolated
    expect(m.latestMembers).toBe(7_174_638);
    expect(m.latestEntered).toBe(38_200);
    expect(m.latestExited).toBe(26_500);
    expect(m.windowChangePct).toBeCloseTo(0.1638, 3);
  });

  it('returns null for an empty window and null change for a single point', () => {
    expect(buildTrajectoryModel(payload({ size: [], delta: [] }))).toBeNull();
    const single = buildTrajectoryModel(
      payload({ size: [{ date: '2026-06-12', members: 100 }], delta: [] }),
    )!;
    expect(single.windowChangePct).toBeNull();
    expect(single.gapCount).toBe(0);
  });

  it('formats compact numbers', () => {
    expect(fmtCompact(7_174_638)).toBe('7.17M');
    expect(fmtCompact(38_200)).toBe('38.2k');
    expect(fmtCompact(224)).toBe('224');
  });
});

describe('<TrajectoryCard />', () => {
  it('renders stat rail + freshness and gap chips from live data', async () => {
    render(<TrajectoryCard segment={seg()} />);
    // '7.17M' renders in both the stat rail and the SVG max-axis label.
    await waitFor(() => expect(screen.getAllByText('7.17M').length).toBeGreaterThan(0));
    expect(screen.getByText('latest 2026-06-12')).toBeTruthy();
    expect(screen.getByText('1 night missed')).toBeTruthy();
    expect(screen.getByText('+38.2k')).toBeTruthy();
    expect(screen.getByText('−26.5k')).toBeTruthy();
  });

  it('shows the informative empty state when no partitions exist', async () => {
    apiFetchMock.mockResolvedValue(payload({ size: [], delta: [], empty: true }));
    render(<TrajectoryCard segment={seg()} />);
    await waitFor(() => expect(screen.getByText(/No snapshots yet/)).toBeTruthy());
  });

  it('surfaces fetch errors inside the card shell', async () => {
    apiFetchMock.mockRejectedValue(new Error('lakehouse unreachable'));
    render(<TrajectoryCard segment={seg()} />);
    await waitFor(() => expect(screen.getByText(/lakehouse unreachable/)).toBeTruthy());
  });

  it('renders nothing for manual segments', () => {
    const { container } = render(
      <TrajectoryCard segment={{ ...seg(), type: 'manual' } as Segment} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
