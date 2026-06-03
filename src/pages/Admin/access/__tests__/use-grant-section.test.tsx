/**
 * useGrantSection — selection lifecycle for one GrantMatrix.
 * Locks the net-new affordances: bulk select-all / clear, and optimistic
 * rollback (revert the displayed selection to the last server-confirmed grant
 * set when a save fails) so the UI never shows un-persisted state.
 *
 * NOTE: user-event is NOT installed; not needed — this drives the hook directly.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useGrantSection } from '../use-grant-section';

describe('useGrantSection', () => {
  it('selectAll replaces the selection with the given ids', () => {
    const { result } = renderHook(() =>
      useGrantSection(['a'], async () => {}, () => {}),
    );
    act(() => result.current.selectAll(['a', 'b', 'c']));
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c']);
  });

  it('clear empties the selection', () => {
    const { result } = renderHook(() =>
      useGrantSection(['a', 'b'], async () => {}, () => {}),
    );
    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);
  });

  it('toggle adds/removes a single id', () => {
    const { result } = renderHook(() =>
      useGrantSection(['a'], async () => {}, () => {}),
    );
    act(() => result.current.toggle('b', true));
    expect(result.current.selected.has('b')).toBe(true);
    act(() => result.current.toggle('a', false));
    expect(result.current.selected.has('a')).toBe(false);
  });

  it('save persists the current selection and fires onSaved', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useGrantSection(['a'], persist, onSaved),
    );
    act(() => result.current.toggle('b', true));
    act(() => result.current.save());
    await waitFor(() => expect(result.current.saved).toBe(true));
    expect(persist).toHaveBeenCalledWith(['a', 'b']);
    expect(onSaved).toHaveBeenCalled();
  });

  it('rolls back the selection to the granted set when save fails', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('409 last admin'));
    const { result } = renderHook(() =>
      useGrantSection(['a'], persist, () => {}),
    );
    // User edits the selection optimistically...
    act(() => result.current.toggle('b', true));
    expect(result.current.selected.has('b')).toBe(true);
    // ...save fails → selection reverts to the last confirmed grant set ['a'].
    act(() => result.current.save());
    await waitFor(() => expect(result.current.error).toBe('409 last admin'));
    expect([...result.current.selected]).toEqual(['a']);
    expect(result.current.saved).toBe(false);
  });
});
