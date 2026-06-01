/**
 * Tests for compare-toggle.tsx
 *
 * Covers: render in each mode, segment click transitions, game picker
 * appearance, onChange callback values.
 *
 * GameContext is mocked so tests don't need a real provider tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompareToggle } from './compare-toggle';

// ---------------------------------------------------------------------------
// Mock GameContext hook
// ---------------------------------------------------------------------------

const mockGameContext = {
  gameId: 'ptg',
  games: [
    { id: 'ptg', name: 'Play Together', mark: 'PT' },
    { id: 'cfm', name: 'Candy Farm', mark: 'CF' },
    { id: 'xyz', name: 'XYZ Game', mark: 'XY' },
  ],
  defaultGameId: 'ptg',
  setGameId: vi.fn(),
  ready: true,
};

vi.mock('../../components/Header/use-game-context', () => ({
  useGameContext: () => mockGameContext,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderToggle(value: Parameters<typeof CompareToggle>[0]['value'], onChange = vi.fn()) {
  return { onChange, ...render(<CompareToggle value={value} onChange={onChange} />) };
}

// ---------------------------------------------------------------------------
// Render tests
// ---------------------------------------------------------------------------

describe('CompareToggle – render', () => {
  it('renders Off / Prev period / Other game buttons', () => {
    renderToggle(null);
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getByText('Prev period')).toBeTruthy();
    expect(screen.getByText('Other game')).toBeTruthy();
  });

  it('does not show game picker when value is null (Off)', () => {
    renderToggle(null);
    // The native <select> (role combobox) only appears in "Other game" mode.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('marks the "Off" segment selected when value is null', () => {
    renderToggle(null);
    expect(screen.getByText('Off').getAttribute('aria-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Mode transitions via radio buttons
// ---------------------------------------------------------------------------

describe('CompareToggle – segment click transitions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clicking "Prev period" calls onChange("prev")', () => {
    const { onChange } = renderToggle(null);
    fireEvent.click(screen.getByText('Prev period'));
    expect(onChange).toHaveBeenCalledWith('prev');
  });

  it('clicking "Off" calls onChange(null)', () => {
    const { onChange } = renderToggle('prev');
    fireEvent.click(screen.getByText('Off'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('clicking "Other game" calls onChange with first other game', () => {
    const { onChange } = renderToggle(null);
    fireEvent.click(screen.getByText('Other game'));
    // First other game (non-active) is 'cfm'
    expect(onChange).toHaveBeenCalledWith('game:cfm');
  });
});

// ---------------------------------------------------------------------------
// Game dropdown visibility
// ---------------------------------------------------------------------------

describe('CompareToggle – game dropdown', () => {
  it('shows the game picker when value is game:<id>', () => {
    renderToggle('game:cfm');
    // Native <select> exposes the combobox role.
    expect(screen.queryByRole('combobox')).not.toBeNull();
  });

  it('does not show the game picker when value is "prev"', () => {
    renderToggle('prev');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// URL state round-trip (encode/decode helpers used by parent)
// ---------------------------------------------------------------------------

describe('CompareToggle – value reflects URL state', () => {
  it('renders with prev value selected when value="prev"', () => {
    renderToggle('prev');
    // The "Prev period" segment is marked selected via aria-selected.
    expect(screen.getByText('Prev period').getAttribute('aria-selected')).toBe('true');
  });

  it('renders game mode without throwing for valid game:<id>', () => {
    expect(() => renderToggle('game:cfm')).not.toThrow();
  });
});
