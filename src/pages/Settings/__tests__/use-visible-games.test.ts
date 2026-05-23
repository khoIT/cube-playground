/**
 * Unit tests for the game-picker visibility blocklist.
 * Tests cover: default-visible semantics, toggle round-trip, showAll reset,
 * cross-component sync via the custom event, and corrupt-localStorage tolerance.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useVisibleGames } from '../use-visible-games';

const STORAGE_KEY = 'gds-cube:hidden-game-ids';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('useVisibleGames', () => {
  it('defaults all games to visible when no preference is stored', () => {
    const { result } = renderHook(() => useVisibleGames());
    expect(result.current.hidden.size).toBe(0);
    expect(result.current.isVisible('ptg')).toBe(true);
    expect(result.current.isVisible('ballistar')).toBe(true);
  });

  it('toggle adds and removes a game from the hidden set', () => {
    const { result } = renderHook(() => useVisibleGames());

    act(() => result.current.toggle('ptg'));
    expect(result.current.isVisible('ptg')).toBe(false);
    expect(result.current.hidden.has('ptg')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual(['ptg']);

    act(() => result.current.toggle('ptg'));
    expect(result.current.isVisible('ptg')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it('showAll clears all hidden ids', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['ptg', 'ballistar']));
    const { result } = renderHook(() => useVisibleGames());
    expect(result.current.hidden.size).toBe(2);

    act(() => result.current.showAll());
    expect(result.current.hidden.size).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it('syncs across sibling hook instances via the custom event', () => {
    const a = renderHook(() => useVisibleGames());
    const b = renderHook(() => useVisibleGames());

    act(() => a.result.current.toggle('ptg'));

    expect(a.result.current.isVisible('ptg')).toBe(false);
    expect(b.result.current.isVisible('ptg')).toBe(false);
  });

  it('tolerates corrupt JSON in localStorage', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    const { result } = renderHook(() => useVisibleGames());
    expect(result.current.hidden.size).toBe(0);
    expect(result.current.isVisible('ptg')).toBe(true);
  });

  it('ignores non-string entries in stored array', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['ptg', 42, null, 'ballistar']));
    const { result } = renderHook(() => useVisibleGames());
    expect([...result.current.hidden].sort()).toEqual(['ballistar', 'ptg']);
  });
});
