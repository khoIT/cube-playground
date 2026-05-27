/**
 * RTL coverage for Settings → Metric coverage. Mocks the data hook so the
 * section renders in isolation; asserts the three gap views render and that
 * selecting an uncovered measure + scaffolding calls the hook.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const refetchMock = vi.fn().mockResolvedValue(undefined);
const scaffoldMock = vi.fn().mockResolvedValue({ created: ['wau'], skipped: [] });

const report = {
  generatedAt: '2026-05-27T00:00:00.000Z',
  games: [
    {
      game: 'pubg',
      status: 'drift' as const,
      cubesInMeta: 6,
      measuresInMeta: 20,
      brokenRefs: [{ metricId: 'cost', ref: 'mf_users.marketing_cost', reason: 'member-missing' as const }],
      uncoveredMeasures: ['active_daily.wau'],
    },
  ],
  matrix: [
    { metricId: 'cost', game: 'pubg', state: 'broken' as const },
    { metricId: 'dau', game: 'pubg', state: 'resolves' as const },
  ],
};

vi.mock('../use-metric-coverage', () => ({
  useMetricCoverage: () => ({
    report,
    loading: false,
    error: null,
    refetch: refetchMock,
    scaffold: scaffoldMock,
  }),
}));

import { MetricCoverageSection } from '../metric-coverage-section';

beforeEach(() => {
  cleanup();
  refetchMock.mockClear();
  scaffoldMock.mockClear();
});

describe('MetricCoverageSection', () => {
  it('renders the summary, matrix, and reveals gaps when sections are expanded', () => {
    render(<MetricCoverageSection />);
    // Always-visible summary + matrix (matrix defaults open).
    expect(screen.getByText('Metric coverage')).toBeTruthy();
    expect(screen.getByText('1 broken metric(s)')).toBeTruthy();
    expect(screen.getAllByText('cost').length).toBeGreaterThan(0); // matrix row

    // Expand the per-game broken disclosure → its broken ref appears.
    fireEvent.click(screen.getByRole('button', { name: /pubg.*broken/ }));
    expect(screen.getByText(/marketing_cost/)).toBeTruthy();

    // Expand uncovered measures → candidate appears.
    fireEvent.click(screen.getByRole('button', { name: /Uncovered measures/ }));
    expect(screen.getByText('active_daily.wau')).toBeTruthy();
  });

  it('scaffolds the selected uncovered measure', async () => {
    render(<MetricCoverageSection />);
    fireEvent.click(screen.getByRole('button', { name: /Uncovered measures/ }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Scaffold 1 draft/ }));
    await waitFor(() => expect(scaffoldMock).toHaveBeenCalledWith(['active_daily.wau']));
  });
});
