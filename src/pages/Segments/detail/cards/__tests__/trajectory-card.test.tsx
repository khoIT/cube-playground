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
  buildTrajectoryModelFromMovement,
  fmtCompact,
  fmtTrajectoryTick,
  type TrajectoryPayload,
} from '../trajectory-card-model';

const apiFetchMock = vi.fn();
vi.mock('../../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const movementMock = vi.fn();
vi.mock('../../../../../api/segment-movement-client', () => ({
  segmentMovementClient: { movement: (...args: unknown[]) => movementMock(...args) },
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
  movementMock.mockReset();
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

describe('buildTrajectoryModelFromMovement', () => {
  it('builds a continuous (gapless) model from movement buckets', () => {
    const m = buildTrajectoryModelFromMovement([
      { ts: '2026-06-21 00:00:00', memberCount: 1000, entered: 0, exited: 0 },
      { ts: '2026-06-21 06:00:00', memberCount: 1100, entered: 120, exited: 20 },
      { ts: '2026-06-21 12:00:00', memberCount: 1050, entered: 10, exited: 60 },
    ])!;
    // No synthetic day-stepping/gaps — buckets render as returned.
    expect(m.days).toHaveLength(3);
    expect(m.gapCount).toBe(0);
    expect(m.latestDate).toBe('2026-06-21 12:00:00');
    expect(m.latestMembers).toBe(1050);
    expect(m.maxMembers).toBe(1100);
    expect(m.minMembers).toBe(1000);
    expect(m.windowChangePct).toBeCloseTo(5.0, 5);
  });

  it('returns null when no bucket has a member count', () => {
    expect(buildTrajectoryModelFromMovement([{ ts: '2026-06-21 00:00:00' }])).toBeNull();
    expect(buildTrajectoryModelFromMovement([])).toBeNull();
  });
});

describe('fmtTrajectoryTick', () => {
  it('renders MM-DD for daily and DD HH:MM for sub-daily', () => {
    expect(fmtTrajectoryTick('2026-06-21')).toBe('06-21');
    expect(fmtTrajectoryTick('2026-06-21 14:00:00')).toBe('21 14:00');
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

  it('re-sources from the grain-aware movement feed for sub-daily grains', async () => {
    movementMock.mockResolvedValue({
      points: [
        { ts: '2026-06-21 00:00:00', memberCount: 1_000_000, entered: 0, exited: 0 },
        { ts: '2026-06-21 12:00:00', memberCount: 1_100_000, entered: 120_000, exited: 20_000 },
      ],
    });
    render(<TrajectoryCard segment={seg()} granularity="12h" from="2026-06-20" to="2026-06-21" />);
    await waitFor(() => expect(movementMock).toHaveBeenCalled());
    // Daily snapshot endpoint must NOT be hit on the sub-daily path.
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(movementMock.mock.calls[0][1]).toMatchObject({ granularity: '12h' });
    await waitFor(() => expect(screen.getByText('latest 2026-06-21 12:00')).toBeTruthy());
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
