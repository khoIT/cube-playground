/**
 * Render + interaction tests for TurnAnnotationToggle.
 *
 * Covers: initial render (unstarred, starred), toggle star, flag change,
 * optimistic update, note field expand/save.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnAnnotationToggle } from '../turn-annotation-toggle';
import type { TurnAnnotation } from '../use-debug-api-types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../api/chat-owner-id', () => ({ getOwnerId: () => 'test-owner' }));

const mockFetch = (payload: unknown, status = 200) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(payload),
  } as Response);
};

beforeEach(() => { vi.clearAllMocks(); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nullAnnotation: TurnAnnotation | null = null;
const starredAnnotation: TurnAnnotation = {
  turnId: 'turn-1',
  starred: true,
  flag: null,
  note: null,
  updatedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TurnAnnotationToggle', () => {
  it('renders unstarred star button when no annotation', () => {
    render(<TurnAnnotationToggle turnId="turn-1" initial={nullAnnotation} />);
    expect(screen.getByTestId('star-toggle').textContent).toBe('☆');
  });

  it('renders starred star button when annotation.starred=true', () => {
    render(<TurnAnnotationToggle turnId="turn-1" initial={starredAnnotation} />);
    expect(screen.getByTestId('star-toggle').textContent).toBe('★');
  });

  it('calls POST on star toggle and updates optimistically', async () => {
    const saved: TurnAnnotation = { turnId: 'turn-1', starred: true, flag: null, note: null, updatedAt: Date.now() };
    mockFetch(saved);

    render(<TurnAnnotationToggle turnId="turn-1" initial={nullAnnotation} />);
    const btn = screen.getByTestId('star-toggle');
    expect(btn.textContent).toBe('☆');

    await act(async () => { fireEvent.click(btn); });

    await waitFor(() => {
      expect(screen.getByTestId('star-toggle').textContent).toBe('★');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/debug/turns/turn-1/annotation'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders flag dropdown with default empty/no-flag option', () => {
    render(<TurnAnnotationToggle turnId="turn-1" initial={nullAnnotation} />);
    const select = screen.getByTestId('flag-select') as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('calls POST when flag changes', async () => {
    const saved: TurnAnnotation = { turnId: 'turn-1', starred: false, flag: 'bug', note: null, updatedAt: Date.now() };
    mockFetch(saved);

    render(<TurnAnnotationToggle turnId="turn-1" initial={nullAnnotation} />);
    const select = screen.getByTestId('flag-select');

    await act(async () => {
      fireEvent.change(select, { target: { value: 'bug' } });
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/debug/turns/turn-1/annotation'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows note textarea when note-toggle is clicked', async () => {
    render(<TurnAnnotationToggle turnId="turn-1" initial={nullAnnotation} />);
    expect(screen.queryByTestId('note-textarea')).toBeNull();

    fireEvent.click(screen.getByTestId('note-toggle'));
    expect(screen.getByTestId('note-textarea')).toBeTruthy();
  });

  it('saves note on save button click', async () => {
    const saved: TurnAnnotation = { turnId: 'turn-1', starred: false, flag: null, note: 'my note', updatedAt: Date.now() };
    mockFetch(saved);

    render(<TurnAnnotationToggle turnId="turn-1" initial={nullAnnotation} />);
    fireEvent.click(screen.getByTestId('note-toggle'));

    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'my note' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('note-save'));
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/debug/turns/turn-1/annotation'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows flagged annotation from initial prop', () => {
    const flagged: TurnAnnotation = { turnId: 'turn-1', starred: false, flag: 'important', note: null, updatedAt: Date.now() };
    render(<TurnAnnotationToggle turnId="turn-1" initial={flagged} />);
    const select = screen.getByTestId('flag-select') as HTMLSelectElement;
    expect(select.value).toBe('important');
  });
});
