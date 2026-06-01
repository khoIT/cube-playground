/**
 * Wiring smoke tests for the compare feature.
 *
 * These tests verify that:
 * 1. CompareToggle renders inside a CompareContext.Provider without errors.
 * 2. CompareContext default value is correctly shaped (idle state).
 * 3. readCompareFromUrl / writeCompareToUrl round-trip via window.location.hash.
 *
 * We intentionally avoid rendering QueryBuilderInternals itself — it requires
 * the full QueryBuilderContext tree which would need a real CubeJS provider.
 * Instead we test each consumed symbol in isolation, confirming the imports
 * compile and the contracts hold.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompareContext, useCompareContext } from './compare-context';
import { CompareToggle } from './compare-toggle';
import { readCompareFromUrl, writeCompareToUrl } from './compare-url-codec';

// ---------------------------------------------------------------------------
// Mock GameContext so CompareToggle can render without the real provider tree.
// ---------------------------------------------------------------------------

vi.mock('../../components/Header/use-game-context', () => ({
  useGameContext: () => ({
    gameId: 'ptg',
    games: [
      { id: 'ptg', name: 'Play Together', mark: 'PT' },
      { id: 'cfm', name: 'Candy Farm', mark: 'CF' },
    ],
    defaultGameId: 'ptg',
    setGameId: vi.fn(),
    ready: true,
  }),
}));

// ---------------------------------------------------------------------------
// 1. CompareToggle inside CompareContext.Provider
// ---------------------------------------------------------------------------

describe('CompareToggle inside CompareContext.Provider', () => {
  it('renders without throwing when wrapped in provider', () => {
    expect(() =>
      render(
        <CompareContext.Provider
          value={{
            compareSetting: null,
            compareState: { mergedRows: null, isLoading: false, error: null, compLabel: '', unavailableMeasures: [] },
            onCompareChange: vi.fn(),
          }}
        >
          <CompareToggle value={null} onChange={vi.fn()} />
        </CompareContext.Provider>,
      ),
    ).not.toThrow();
  });

  it('displays the mode segments (Off / Prev period / Other game)', () => {
    render(
      <CompareContext.Provider
        value={{
          compareSetting: null,
          compareState: { mergedRows: null, isLoading: false, error: null, compLabel: '', unavailableMeasures: [] },
          onCompareChange: vi.fn(),
        }}
      >
        <CompareToggle value={null} onChange={vi.fn()} />
      </CompareContext.Provider>,
    );
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getByText('Prev period')).toBeTruthy();
    expect(screen.getByText('Other game')).toBeTruthy();
  });

  it('marks the "Prev period" segment selected when value is "prev"', () => {
    render(
      <CompareContext.Provider
        value={{
          compareSetting: 'prev',
          compareState: {
            mergedRows: null,
            isLoading: false,
            error: null,
            compLabel: 'Prior period',
            unavailableMeasures: [],
          },
          onCompareChange: vi.fn(),
        }}
      >
        <CompareToggle value="prev" onChange={vi.fn()} />
      </CompareContext.Provider>,
    );
    const prev = screen.getByText('Prev period');
    expect(prev.getAttribute('aria-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 2. CompareContext default shape
// ---------------------------------------------------------------------------

describe('useCompareContext default value', () => {
  it('returns compareSetting=null from default context', () => {
    let captured: ReturnType<typeof useCompareContext> | null = null;
    function Spy() {
      captured = useCompareContext();
      return null;
    }
    render(<Spy />);
    expect(captured).not.toBeNull();
    expect((captured as ReturnType<typeof useCompareContext>).compareSetting).toBeNull();
    expect((captured as ReturnType<typeof useCompareContext>).compareState.mergedRows).toBeNull();
    expect((captured as ReturnType<typeof useCompareContext>).compareState.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. URL codec round-trip
// ---------------------------------------------------------------------------

describe('readCompareFromUrl / writeCompareToUrl', () => {
  const originalHash = window.location.hash;

  afterEach(() => {
    // Restore hash after each test.
    window.history.replaceState(null, '', originalHash || '#/');
  });

  it('readCompareFromUrl returns null when no compare param in hash', () => {
    window.history.replaceState(null, '', '#/build?query=%7B%7D');
    expect(readCompareFromUrl()).toBeNull();
  });

  it('round-trips "prev" through URL', () => {
    window.history.replaceState(null, '', '#/build?query=%7B%7D');
    writeCompareToUrl('prev');
    expect(readCompareFromUrl()).toBe('prev');
  });

  it('round-trips "game:cfm" through URL', () => {
    window.history.replaceState(null, '', '#/build?query=%7B%7D');
    writeCompareToUrl('game:cfm');
    expect(readCompareFromUrl()).toBe('game:cfm');
  });

  it('writeCompareToUrl(null) removes the param', () => {
    window.history.replaceState(null, '', '#/build?query=%7B%7D&compare=prev');
    writeCompareToUrl(null);
    expect(readCompareFromUrl()).toBeNull();
  });
});
