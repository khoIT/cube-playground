/**
 * Tests for SessionRowMenu:
 *   1. Kebab click opens the menu with Rename / Delete items.
 *   2. Rename → input prefilled, Enter commits PATCH, Esc cancels without fetch.
 *   3. Delete → confirm → DELETE fetch called; cancel → no fetch.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionRowMenu } from '../components/session-row-menu';
import type { SessionSummary } from '../hooks/use-chat-sessions-list';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSession: SessionSummary = {
  id: 'sess-abc',
  gameId: 'ptg',
  title: 'My test session',
  createdAt: '2026-05-23T10:00:00Z',
};

function renderMenu(overrides?: {
  onRenamed?: (t: string) => void;
  onDeleted?: () => void;
}) {
  const onRenamed = overrides?.onRenamed ?? vi.fn();
  const onDeleted = overrides?.onDeleted ?? vi.fn();
  render(
    <SessionRowMenu
      session={mockSession}
      onRenamed={onRenamed}
      onDeleted={onDeleted}
    />,
  );
  return { onRenamed, onDeleted };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionRowMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the kebab button', () => {
    renderMenu();
    expect(screen.getByTestId('session-row-menu')).toBeTruthy();
  });

  it('clicking kebab opens Rename and Delete items', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('session-row-menu'));
    expect(screen.getByTestId('session-row-menu-rename')).toBeTruthy();
    expect(screen.getByTestId('session-row-menu-delete')).toBeTruthy();
  });

  it('clicking Rename shows input prefilled with session title', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('session-row-menu'));
    fireEvent.click(screen.getByTestId('session-row-menu-rename'));
    const input = screen.getByTestId('session-row-rename-input').querySelector('input');
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('My test session');
  });

  it('Enter in rename input calls PATCH and onRenamed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const { onRenamed } = renderMenu();

    fireEvent.click(screen.getByTestId('session-row-menu'));
    fireEvent.click(screen.getByTestId('session-row-menu-rename'));

    const input = screen.getByTestId('session-row-rename-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/chat/sessions/sess-abc',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'New title' }),
        }),
      );
    });
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith('New title'));
  });

  it('Esc in rename input dismisses without calling fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    renderMenu();
    fireEvent.click(screen.getByTestId('session-row-menu'));
    fireEvent.click(screen.getByTestId('session-row-menu-rename'));

    const input = screen.getByTestId('session-row-rename-input').querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(fetchSpy).not.toHaveBeenCalled();
    // Input should be gone.
    expect(screen.queryByTestId('session-row-rename-input')).toBeNull();
  });

  it('clicking Delete shows confirm UI, confirm calls DELETE and onDeleted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const { onDeleted } = renderMenu();

    fireEvent.click(screen.getByTestId('session-row-menu'));
    fireEvent.click(screen.getByTestId('session-row-menu-delete'));

    expect(screen.getByTestId('session-row-delete-confirm')).toBeTruthy();

    fireEvent.click(screen.getByTestId('session-row-delete-confirm-btn'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/chat/sessions/sess-abc',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('cancel on delete confirm does not call fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    renderMenu();
    fireEvent.click(screen.getByTestId('session-row-menu'));
    fireEvent.click(screen.getByTestId('session-row-menu-delete'));
    // Click the Cancel button (not the Delete confirm)
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('session-row-delete-confirm')).toBeNull();
  });
});
