/**
 * RTL coverage for the artifact sweep panel.
 * Mocks apiFetch so no real network calls are made.
 * Covers: run → summary/failures, live checkbox toggles body, prefix disabled.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// apiFetch mock — hoisted so the factory can reference it safely
// ---------------------------------------------------------------------------

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../../api/api-client', () => ({
  apiFetch: apiFetchMock,
  getOwner: () => 'dev',
}));

import { ArtifactSweepPanel } from '../artifact-sweep-panel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const okSweepResult = {
  dashboards: [{ kind: 'dashboard', id: 'd1', game: 'pubg', title: 'Daily KPIs', status: 'ok' }],
  segments: [],
  chatArtifacts: [],
  summary: { total: 1, ok: 1, unverified: 0, missingMember: 0, missingPreagg: 0, runtimeError: 0 },
  generatedAt: '2026-06-05T00:00:00.000Z',
};

const failingSweepResult = {
  dashboards: [
    { kind: 'dashboard', id: 'd1', game: 'pubg', title: 'Daily KPIs', status: 'missing-member', refs: ['pubg_dau.active_users'] },
  ],
  segments: [
    { kind: 'segment', id: 's1', game: 'pubg', title: 'Payers', status: 'missing-preagg', detail: 'partition not built' },
  ],
  chatArtifacts: [
    { kind: 'chat', id: 'c1', game: null, title: 'MAU query', status: 'runtime-error', detail: 'cube timeout' },
    { kind: 'chat', id: 'c2', game: 'pubg', title: 'Revenue', status: 'unverified' },
  ],
  summary: { total: 4, ok: 0, unverified: 1, missingMember: 1, missingPreagg: 1, runtimeError: 1 },
  generatedAt: '2026-06-05T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArtifactSweepPanel', () => {
  describe('initial render', () => {
    it('shows the section heading', () => {
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);
      expect(screen.getByText('Artifact validation')).toBeTruthy();
    });

    it('renders the Validate artifacts button', () => {
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);
      expect(screen.getByTestId('validate-artifacts-btn')).toBeTruthy();
    });

    it('renders the live probes checkbox unchecked by default', () => {
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);
      const checkbox = screen.getByTestId('live-probe-checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('does NOT fetch on mount', () => {
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);
      expect(apiFetchMock).not.toHaveBeenCalled();
    });

    it('shows no summary or failure list before first run', () => {
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);
      expect(screen.queryByTestId('summary-chips')).toBeNull();
      expect(screen.queryByTestId('failure-list')).toBeNull();
    });
  });

  describe('run → summary rendering', () => {
    it('issues exactly one POST and renders summary chips after run', async () => {
      apiFetchMock.mockResolvedValueOnce(okSweepResult);
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));

      await waitFor(() => expect(screen.getByTestId('summary-chips')).toBeTruthy());
      expect(apiFetchMock).toHaveBeenCalledTimes(1);

      // Summary chips
      expect(screen.getByText('1 total')).toBeTruthy();
      expect(screen.getByText('1 ok')).toBeTruthy();
    });

    it('renders all summary chip types for a mixed result', async () => {
      apiFetchMock.mockResolvedValueOnce(failingSweepResult);
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));

      await waitFor(() => expect(screen.getByTestId('summary-chips')).toBeTruthy());
      expect(screen.getByText('4 total')).toBeTruthy();
      expect(screen.getByText('1 unverified')).toBeTruthy();
      expect(screen.getByText('1 missing member')).toBeTruthy();
      expect(screen.getByText('1 missing pre-agg')).toBeTruthy();
      expect(screen.getByText('1 runtime error')).toBeTruthy();
    });

    it('shows all-ok message when no failures', async () => {
      apiFetchMock.mockResolvedValueOnce(okSweepResult);
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));

      await waitFor(() => expect(screen.getByTestId('all-ok-msg')).toBeTruthy());
    });
  });

  describe('failing artifacts list', () => {
    it('renders failure rows for non-ok artifacts', async () => {
      apiFetchMock.mockResolvedValueOnce(failingSweepResult);
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));

      await waitFor(() => expect(screen.getByTestId('failure-list')).toBeTruthy());

      // dashboard row — shows kind, title, status, refs
      expect(screen.getByText(/Daily KPIs/)).toBeTruthy();
      // "missing member" appears in both the chip and the row label
      expect(screen.getAllByText(/missing member/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/pubg_dau\.active_users/)).toBeTruthy();

      // segment row
      expect(screen.getByText(/Payers/)).toBeTruthy();
      expect(screen.getAllByText(/missing pre-agg/).length).toBeGreaterThanOrEqual(1);

      // chat runtime-error row
      expect(screen.getByText(/MAU query/)).toBeTruthy();
      expect(screen.getAllByText(/runtime error/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/cube timeout/)).toBeTruthy();

      // chat unverified row (also a failure in the list, muted tone)
      expect(screen.getByText(/Revenue/)).toBeTruthy();
      expect(screen.getAllByText(/unverified/).length).toBeGreaterThanOrEqual(1);
    });

    it('collapse toggle hides and shows the failure list', async () => {
      apiFetchMock.mockResolvedValueOnce(failingSweepResult);
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));
      await waitFor(() => expect(screen.getByTestId('failure-list')).toBeTruthy());

      // Click collapse — list should disappear
      fireEvent.click(screen.getByTestId('collapse-toggle'));
      expect(screen.queryByTestId('failure-list')).toBeNull();

      // Click again — list should reappear
      fireEvent.click(screen.getByTestId('collapse-toggle'));
      expect(screen.getByTestId('failure-list')).toBeTruthy();
    });
  });

  describe('live probe checkbox toggles request body', () => {
    it('sends live:false when checkbox is unchecked', async () => {
      apiFetchMock.mockResolvedValueOnce(okSweepResult);
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));
      await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));

      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/workspaces/local/artifact-sweep',
        expect.objectContaining({ body: { live: false } }),
      );
    });

    it('sends live:true when checkbox is checked', async () => {
      apiFetchMock.mockResolvedValueOnce(okSweepResult);
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      const checkbox = screen.getByTestId('live-probe-checkbox');
      fireEvent.click(checkbox);
      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));
      await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));

      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/workspaces/local/artifact-sweep',
        expect.objectContaining({ body: { live: true } }),
      );
    });
  });

  describe('prefix workspace — disabled state', () => {
    it('disables the run button for a prefix workspace', () => {
      render(<ArtifactSweepPanel workspaceId="prod" gameModel="prefix" />);
      const btn = screen.getByTestId('validate-artifacts-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('shows the n/a hint for a prefix workspace', () => {
      render(<ArtifactSweepPanel workspaceId="prod" gameModel="prefix" />);
      expect(screen.getByTestId('na-hint')).toBeTruthy();
    });

    it('does NOT fetch when the run button is clicked for a prefix workspace', async () => {
      render(<ArtifactSweepPanel workspaceId="prod" gameModel="prefix" />);
      const btn = screen.getByTestId('validate-artifacts-btn') as HTMLButtonElement;
      // Attempt click on disabled button
      fireEvent.click(btn);
      await waitFor(() => expect(apiFetchMock).not.toHaveBeenCalled());
    });

    it('disables the live probe checkbox for a prefix workspace', () => {
      render(<ArtifactSweepPanel workspaceId="prod" gameModel="prefix" />);
      const checkbox = screen.getByTestId('live-probe-checkbox') as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
    });
  });

  describe('error handling', () => {
    it('renders an error banner when the sweep API fails', async () => {
      apiFetchMock.mockRejectedValueOnce(new Error('Network error'));
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));

      await waitFor(() => expect(screen.getByTestId('sweep-error')).toBeTruthy());
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  describe('note rendering', () => {
    it('shows the note when the server returns one', async () => {
      const resultWithNote = { ...okSweepResult, note: 'chat DB unavailable; chat artifacts skipped' };
      apiFetchMock.mockResolvedValueOnce(resultWithNote);
      render(<ArtifactSweepPanel workspaceId="local" gameModel="game_id" />);

      fireEvent.click(screen.getByTestId('validate-artifacts-btn'));

      await waitFor(() => expect(screen.getByTestId('sweep-note')).toBeTruthy());
      expect(screen.getByText(/chat DB unavailable/)).toBeTruthy();
    });
  });
});
