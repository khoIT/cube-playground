/**
 * RecentRunsStrip — persisted card-pass history lines: age/source/tally per
 * run, red dot + expandable failing-card detail on failed runs, pass-aborted
 * marker, hidden entirely with no history.
 *
 * NOTE: user-event is NOT installed; uses fireEvent.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { RecentRunsStrip } from '../segment-refresh-recent-runs';
import type { SegmentCardRun } from '../../../../types/segment-refresh-ops';

const NOW = Date.parse('2026-06-13T01:00:00.000Z');

const cleanRun: SegmentCardRun = {
  id: 2,
  segmentId: 'seg1',
  startedAt: '2026-06-13T00:48:00.000Z',
  finishedAt: '2026-06-13T00:50:00.000Z', // 10m before NOW
  source: 'manual',
  total: 33,
  ok: 33,
  failed: 0,
  failingCards: [],
  runError: null,
};

const failedRun: SegmentCardRun = {
  id: 1,
  segmentId: 'seg1',
  startedAt: '2026-06-12T23:58:00.000Z',
  finishedAt: '2026-06-13T00:00:00.000Z', // 1h before NOW
  source: 'cron',
  total: 33,
  ok: 26,
  failed: 7,
  failingCards: [{ cardId: 'retention-d7', error: 'timed out after 4s' }],
  runError: null,
};

describe('RecentRunsStrip', () => {
  it('renders one line per run with age, source, and tally', () => {
    render(<RecentRunsStrip runs={[cleanRun, failedRun]} now={NOW} />);

    expect(screen.getByText('Recent passes (2)')).toBeTruthy();
    expect(screen.getByText('10m ago')).toBeTruthy();
    expect(screen.getByText('· manual')).toBeTruthy();
    expect(screen.getByText('33/33 ok')).toBeTruthy();
    expect(screen.getByText('1h 0m ago')).toBeTruthy();
    expect(screen.getByText('· cron')).toBeTruthy();
    expect(screen.getByText('26/33 ok')).toBeTruthy();
    expect(screen.getByText('· 7 failed')).toBeTruthy();
  });

  it('expands a failed run to its failing cards with per-run errors', () => {
    render(<RecentRunsStrip runs={[failedRun]} now={NOW} />);

    expect(screen.queryByText('retention-d7')).toBeNull();
    fireEvent.click(screen.getByLabelText('Expand run detail'));
    expect(screen.getByText('retention-d7')).toBeTruthy();
    expect(screen.getByText(/timed out after 4s/)).toBeTruthy();
  });

  it('marks a pass-level abort and renders nothing without history', () => {
    const { container } = render(<RecentRunsStrip runs={[]} now={NOW} />);
    expect(container.firstChild).toBeNull();

    render(
      <RecentRunsStrip
        runs={[{ ...cleanRun, runError: 'card-runner exploded', failed: 0 }]}
        now={NOW}
      />,
    );
    expect(screen.getByText('· pass aborted')).toBeTruthy();
  });
});
