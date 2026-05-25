/**
 * Tests for SearchModeChips:
 * - Renders 3 chips with correct role/aria-checked state
 * - Clicking a chip calls onChange with correct mode
 * - ArrowRight / ArrowLeft keyboard cycling
 * - Home / End jump to first / last chip
 */

import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchModeChips } from '../search-mode-chips';
import type { SearchMode } from '../search-mode-chips';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChips(initial: SearchMode = 'turns', onChange = vi.fn()) {
  function Wrapper() {
    const [mode, setMode] = useState<SearchMode>(initial);
    function handleChange(m: SearchMode) {
      setMode(m);
      onChange(m);
    }
    return <SearchModeChips mode={mode} onChange={handleChange} />;
  }
  return render(<Wrapper />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchModeChips', () => {
  it('renders 3 chips with role=radio', () => {
    renderChips();
    const chips = screen.getAllByRole('radio');
    expect(chips).toHaveLength(3);
  });

  it('radiogroup has aria-label', () => {
    renderChips();
    expect(screen.getByRole('radiogroup', { name: 'Search mode' })).toBeTruthy();
  });

  it('initial mode=turns: Turns chip is aria-checked=true', () => {
    renderChips('turns');
    expect(screen.getByTestId('mode-chip-turns').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('mode-chip-sessions').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('mode-chip-cached').getAttribute('aria-checked')).toBe('false');
  });

  it('initial mode=sessions: Sessions chip is aria-checked=true', () => {
    renderChips('sessions');
    expect(screen.getByTestId('mode-chip-sessions').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('mode-chip-turns').getAttribute('aria-checked')).toBe('false');
  });

  it('clicking Sessions chip calls onChange with "sessions"', () => {
    const onChange = vi.fn();
    renderChips('turns', onChange);
    fireEvent.click(screen.getByTestId('mode-chip-sessions'));
    expect(onChange).toHaveBeenCalledWith('sessions');
  });

  it('clicking Cached queries chip calls onChange with "cached"', () => {
    const onChange = vi.fn();
    renderChips('turns', onChange);
    fireEvent.click(screen.getByTestId('mode-chip-cached'));
    expect(onChange).toHaveBeenCalledWith('cached');
  });

  it('ArrowRight from Turns moves focus to Sessions', () => {
    renderChips('turns');
    const turnsChip = screen.getByTestId('mode-chip-turns');
    fireEvent.keyDown(turnsChip, { key: 'ArrowRight' });
    expect(screen.getByTestId('mode-chip-sessions')).toHaveAttribute('aria-checked', 'true');
  });

  it('ArrowRight wraps from Cached to Turns', () => {
    renderChips('cached');
    const cachedChip = screen.getByTestId('mode-chip-cached');
    fireEvent.keyDown(cachedChip, { key: 'ArrowRight' });
    expect(screen.getByTestId('mode-chip-turns')).toHaveAttribute('aria-checked', 'true');
  });

  it('ArrowLeft from Turns wraps to Cached', () => {
    renderChips('turns');
    const turnsChip = screen.getByTestId('mode-chip-turns');
    fireEvent.keyDown(turnsChip, { key: 'ArrowLeft' });
    expect(screen.getByTestId('mode-chip-cached')).toHaveAttribute('aria-checked', 'true');
  });

  it('Home key jumps to first chip (Turns)', () => {
    renderChips('cached');
    const cachedChip = screen.getByTestId('mode-chip-cached');
    fireEvent.keyDown(cachedChip, { key: 'Home' });
    expect(screen.getByTestId('mode-chip-turns')).toHaveAttribute('aria-checked', 'true');
  });

  it('End key jumps to last chip (Cached queries)', () => {
    renderChips('turns');
    const turnsChip = screen.getByTestId('mode-chip-turns');
    fireEvent.keyDown(turnsChip, { key: 'End' });
    expect(screen.getByTestId('mode-chip-cached')).toHaveAttribute('aria-checked', 'true');
  });
});
