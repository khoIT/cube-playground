/**
 * SegmentRefreshOpsTab — renders the cron heartbeat strip + segment table from
 * GET /api/segment-refresh/ops, surfaces the Unstick action on wedged rows, and
 * POSTs the unstick endpoint on click.
 *
 * NOTE: user-event is NOT installed; uses fireEvent.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApiFetch = vi.fn();
vi.mock('../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { SegmentRefreshOpsTab } from '../segment-refresh-ops-tab';

const OPS = {
  generatedAt: '2026-06-11T00:00:00.000Z',
  cron: { lastTickAt: '2026-06-10T23:59:30.000Z', tickIntervalMs: 60_000, sinceLastTickMs: 30_000 },
  queue: { processing: false, size: 0, queuedIds: [] },
  watchdog: { enabled: true, wedgeFloorMin: 10 },
  summary: { total: 3, wedged: 1, degraded: 1, servingStale: 0, broken: 0, inFlight: 0, due: 0, healthy: 1 },
  segments: [
    {
      id: 's-wedged', name: 'Wedged cohort', gameId: 'jus_vn', workspace: 'local',
      status: 'refreshing', derivedState: 'wedged', lastRefreshedAt: null, cadenceMin: 60,
      ageMs: null, overdueByMs: 0, uidCount: 1000, brokenReason: null,
      cards: { ok: 0, error: 0, total: 0 }, failingCards: 0, newestCardAgeMs: null, cardsStale: false, erroringCards: [],
    },
    {
      id: 's-degraded', name: 'Degraded cohort', gameId: 'cfm_vn', workspace: 'local',
      status: 'fresh', derivedState: 'degraded', lastRefreshedAt: '2026-06-10T23:55:00.000Z', cadenceMin: 60,
      ageMs: 300_000, overdueByMs: 0, uidCount: 500, brokenReason: null,
      cards: { ok: 3, error: 1, total: 4 }, failingCards: 1, newestCardAgeMs: 240_000, cardsStale: false,
      erroringCards: [{ cardId: 'arpu', error: 'cold query timeout' }],
    },
    {
      id: 's-healthy', name: 'Healthy cohort', gameId: 'jus_vn', workspace: 'local',
      status: 'fresh', derivedState: 'healthy', lastRefreshedAt: '2026-06-10T23:58:00.000Z', cadenceMin: 60,
      ageMs: 120_000, overdueByMs: 0, uidCount: 800, brokenReason: null,
      cards: { ok: 2, error: 0, total: 2 }, failingCards: 0, newestCardAgeMs: 100_000, cardsStale: false, erroringCards: [],
    },
  ],
};

describe('SegmentRefreshOpsTab', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/segment-refresh/ops')) return Promise.resolve(OPS);
      if (url.startsWith('/api/segment-refresh/snapshot-runs')) {
        return Promise.resolve({ enabledHere: false, runs: [], latestLanded: null, latestLandedError: null });
      }
      return Promise.resolve({});
    });
  });

  it('renders the heartbeat strip with the watchdog note + alert labels', async () => {
    render(<SegmentRefreshOpsTab />);
    // wedge floor surfaced in watchdog note (unique → safe to await)
    expect(await screen.findByText(/auto-unsticks after 10m/)).toBeDefined();
    // "Wedged" appears both as a heartbeat stat label and a row chip
    expect(screen.getAllByText('Wedged').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Degraded').length).toBeGreaterThanOrEqual(1);
  });

  it('lists segments and shows Unstick only on the wedged row', async () => {
    render(<SegmentRefreshOpsTab />);
    expect(await screen.findByText('Wedged cohort')).toBeDefined();
    expect(screen.getByText('Degraded cohort')).toBeDefined();
    // exactly one Unstick button (wedged row only)
    const unstick = screen.getAllByText('Unstick');
    expect(unstick).toHaveLength(1);
  });

  it('POSTs the unstick endpoint when Unstick is clicked', async () => {
    render(<SegmentRefreshOpsTab />);
    const btn = await screen.findByText('Unstick');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/segment-refresh/s-wedged/unstick',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
