/**
 * Pin-to-dashboard modal: happy path tests.
 * Covers existing-dashboard pin and create-new flow.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDashboards = [
  { id: 1, owner: 'alice', game: 'ptg', slug: 'my-dash', title: 'My Dash', created_at: '', updated_at: '' },
];

vi.mock('../use-dashboards', () => ({
  useDashboards: () => ({
    dashboards: mockDashboards,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const mockAddTile = vi.fn();
const mockCreate = vi.fn();

vi.mock('../../../api/dashboards-client', () => ({
  dashboardsClient: {
    addTile: (...args: unknown[]) => mockAddTile(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { PinToDashboardModal } from '../pin-to-dashboard-modal';

const baseProps = {
  gameId: 'ptg',
  queryJson: '{"measures":["Orders.count"]}',
  vizType: 'table' as const,
  onClose: vi.fn(),
  onPinned: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAddTile.mockResolvedValue({ id: 42 });
  mockCreate.mockResolvedValue({ id: 1, slug: 'new-dash' });
});

describe('PinToDashboardModal — existing dashboard', () => {
  it('renders existing dashboards and pins to selected one', async () => {
    render(<PinToDashboardModal {...baseProps} />);

    expect(screen.getByText('My Dash')).toBeTruthy();

    // "My Dash" radio should be pre-selected (first item auto-select)
    const radio = screen.getByRole('radio', { name: /my-dash/i }) as HTMLInputElement;
    expect(radio.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^pin$/i }));

    await waitFor(() => {
      expect(mockAddTile).toHaveBeenCalledWith(
        'my-dash',
        'ptg',
        expect.objectContaining({
          query_json: '{"measures":["Orders.count"]}',
          viz_type: 'table',
        }),
      );
      expect(baseProps.onPinned).toHaveBeenCalled();
      expect(baseProps.onClose).toHaveBeenCalled();
    });
  });

  it('shows 409 error as readable message', async () => {
    const { SegmentApiError } = await import('../../../api/api-client');
    mockAddTile.mockRejectedValue(new SegmentApiError('tile_cap_exceeded', 'cap', 409));

    render(<PinToDashboardModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^pin$/i }));

    await waitFor(() => {
      expect(screen.getByText(/dashboard is full/i)).toBeTruthy();
    });
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });
});

describe('PinToDashboardModal — create new', () => {
  it('creates a new dashboard then pins the tile', async () => {
    render(<PinToDashboardModal {...baseProps} />);

    // Switch to create mode
    fireEvent.click(screen.getByRole('button', { name: /create new/i }));

    const titleInput = screen.getByPlaceholderText('My Dashboard');
    await act(async () => { fireEvent.change(titleInput, { target: { value: 'New Dash' } }); });

    // Slug should auto-derive
    const slugInput = screen.getByPlaceholderText('my-dashboard') as HTMLInputElement;
    expect(slugInput.value).toBe('new-dash');

    fireEvent.click(screen.getByRole('button', { name: /^pin$/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ game: 'ptg', slug: 'new-dash', title: 'New Dash' }),
      );
      expect(mockAddTile).toHaveBeenCalledWith(
        'new-dash',
        'ptg',
        expect.objectContaining({ viz_type: 'table' }),
      );
      expect(baseProps.onPinned).toHaveBeenCalled();
    });
  });

  it('shows validation error when title is empty', async () => {
    render(<PinToDashboardModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /create new/i }));
    fireEvent.click(screen.getByRole('button', { name: /^pin$/i }));

    await waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeTruthy();
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows slug conflict error on 409', async () => {
    const { SegmentApiError } = await import('../../../api/api-client');
    mockCreate.mockRejectedValue(new SegmentApiError('SLUG_CONFLICT', 'conflict', 409));

    render(<PinToDashboardModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /create new/i }));

    fireEvent.change(screen.getByPlaceholderText('My Dashboard'), {
      target: { value: 'Clash Dash' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^pin$/i }));

    await waitFor(() => {
      expect(screen.getByText(/slug already exists/i)).toBeTruthy();
    });
  });
});
