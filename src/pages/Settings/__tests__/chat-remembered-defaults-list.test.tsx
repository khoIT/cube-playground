/**
 * RTL coverage for the Settings → Chat "Remembered defaults" list.
 * Mocks the API client + GameContext so the component renders in isolation.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'ptg',
}));

vi.mock('../../../hooks/security-context', () => ({
  useSecurityContext: () => ({ token: null }),
}));

const listMock = vi.fn();
const delOneMock = vi.fn();
const delAllMock = vi.fn();

vi.mock('../../../api/chat-user-prefs-client', () => ({
  listRememberedDefaults: (...args: unknown[]) => listMock(...args),
  deleteRememberedDefault: (...args: unknown[]) => delOneMock(...args),
  deleteAllRememberedDefaults: (...args: unknown[]) => delAllMock(...args),
}));

import { ChatRememberedDefaultsList } from '../chat-remembered-defaults-list';

beforeEach(() => {
  cleanup();
  listMock.mockReset();
  delOneMock.mockReset();
  delAllMock.mockReset();
});

const sampleRows = [
  { slot: 'metric', value: 'recharge.arpdau', label: 'ARPDAU', lastUsedAt: Date.now() - 60_000, hitCount: 3 },
  { slot: 'timeRange', value: { dateRange: 'this month' }, phrase: 'this month', label: 'this month', lastUsedAt: Date.now() - 120_000, hitCount: 1 },
  { slot: 'filter:players.channel', value: 'web', label: 'Filter (Channel)', lastUsedAt: Date.now() - 3_600_000, hitCount: 1 },
];

describe('ChatRememberedDefaultsList', () => {
  it('renders empty state when there are no rows', async () => {
    listMock.mockResolvedValueOnce([]);
    render(<ChatRememberedDefaultsList />);
    await waitFor(() => {
      expect(screen.getByTestId('remembered-defaults-empty')).toBeTruthy();
    });
    expect(screen.queryByTestId('remembered-default-row')).toBeNull();
  });

  it('renders one row per remembered slot', async () => {
    listMock.mockResolvedValueOnce(sampleRows);
    render(<ChatRememberedDefaultsList />);
    await waitFor(() => {
      expect(screen.getAllByTestId('remembered-default-row')).toHaveLength(3);
    });
    expect(screen.getByText('ARPDAU')).toBeTruthy();
    expect(screen.getByText('this month')).toBeTruthy();
    expect(screen.getByText('Filter (Channel)')).toBeTruthy();
  });

  it('removeOne button fires DELETE then refreshes', async () => {
    listMock.mockResolvedValueOnce(sampleRows);
    listMock.mockResolvedValueOnce(sampleRows.slice(1)); // after delete
    delOneMock.mockResolvedValueOnce(true);

    render(<ChatRememberedDefaultsList />);
    await waitFor(() => expect(screen.getAllByTestId('remembered-default-row')).toHaveLength(3));

    // Locate the metric row by data-slot and click its button.
    const metricRow = document.querySelector('[data-slot="metric"]') as HTMLElement;
    expect(metricRow).toBeTruthy();
    fireEvent.click(metricRow.querySelector('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(delOneMock).toHaveBeenCalledWith('ptg', 'metric');
      expect(screen.getAllByTestId('remembered-default-row')).toHaveLength(2);
    });
  });

  it('clear-all triggers DELETE-all after confirm', async () => {
    listMock.mockResolvedValueOnce(sampleRows);
    listMock.mockResolvedValueOnce([]); // after clear-all
    delAllMock.mockResolvedValueOnce(true);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ChatRememberedDefaultsList />);
    await waitFor(() => expect(screen.getAllByTestId('remembered-default-row')).toHaveLength(3));

    fireEvent.click(screen.getByTestId('remembered-defaults-clear-all'));

    await waitFor(() => {
      expect(delAllMock).toHaveBeenCalledWith('ptg');
      expect(screen.getByTestId('remembered-defaults-empty')).toBeTruthy();
    });

    confirmSpy.mockRestore();
  });

  it('clear-all aborts when the user cancels the confirm', async () => {
    listMock.mockResolvedValueOnce(sampleRows);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<ChatRememberedDefaultsList />);
    await waitFor(() => expect(screen.getAllByTestId('remembered-default-row')).toHaveLength(3));

    fireEvent.click(screen.getByTestId('remembered-defaults-clear-all'));
    expect(delAllMock).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});
