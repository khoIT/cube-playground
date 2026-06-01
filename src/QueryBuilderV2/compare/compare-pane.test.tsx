/**
 * ComparePane tests — the right-pane Compare tab.
 *
 * ComparePane reads the active query from QueryBuilderContext (only `query`)
 * and compare state from CompareContext. We mock the QueryBuilderContext hook
 * to a minimal query and drive CompareContext via its Provider, so the pane
 * renders in isolation without the full CubeJS provider tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CompareContext } from './compare-context';
import { ComparePane } from './compare-pane';
import type { MergedRow } from './merge-by-dim-key';
import type { CompareResultsState } from './use-compare-results';

// Mock GameContext so the embedded CompareToggle can render.
vi.mock('../../components/Header/use-game-context', () => ({
  useGameContext: () => ({
    gameId: 'ptg',
    games: [
      { id: 'ptg', name: 'Play Together' },
      { id: 'bls', name: 'Ballistar' },
    ],
    defaultGameId: 'ptg',
    setGameId: vi.fn(),
    ready: true,
  }),
}));

// Mock QueryBuilderContext — ComparePane only consumes `query`.
const mockQuery = {
  measures: ['recharge.revenue_vnd'],
  dimensions: ['recharge.os_platform'],
  timeDimensions: [{ dimension: 'recharge.recharge_date', granularity: 'week' }],
};
vi.mock('../context', () => ({
  useQueryBuilderContext: () => ({ query: mockQuery }),
}));

function renderPane(setting: any, state: Partial<CompareResultsState>) {
  const compareState: CompareResultsState = {
    mergedRows: null,
    isLoading: false,
    error: null,
    compLabel: '',
    unavailableMeasures: [],
    ...state,
  };
  return render(
    <CompareContext.Provider
      value={{ compareSetting: setting, compareState, onCompareChange: vi.fn() }}
    >
      <ComparePane />
    </CompareContext.Provider>,
  );
}

describe('ComparePane', () => {
  it('shows the empty-state hint when compare is off', () => {
    renderPane(null, {});
    expect(screen.getByText(/Pick/)).toBeTruthy();
    // Toggle segments still render.
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('renders grouped bars with readable labels and the friendly game name', () => {
    const rows: MergedRow[] = [
      {
        'recharge.os_platform': 'IOS',
        'recharge.recharge_date.week': '2026-05-04T00:00:00.000',
        'recharge.revenue_vnd': 1_450_000_000,
        'recharge.revenue_vnd__cmp': 514_000_000,
        'recharge.revenue_vnd__delta': 936_000_000,
        'recharge.revenue_vnd__deltaPct': 1.82,
      } as MergedRow,
    ];
    renderPane('game:bls', {
      mergedRows: rows,
      compLabel: 'Game: bls',
      unavailableMeasures: [],
    });
    // Row label derived from the dimension value.
    expect(screen.getByText('IOS')).toBeTruthy();
    // Time-dimension ISO value rendered as a readable date (not the raw timestamp).
    expect(screen.getByText('2026-05-04')).toBeTruthy();
    expect(screen.queryByText(/2026-05-04T00:00/)).toBeNull();
    // Compact-formatted current value.
    expect(screen.getByText('1.45B')).toBeTruthy();
    // Friendly game name (not the raw "Game: bls" id label) in the legend.
    expect(screen.getByText('Ballistar')).toBeTruthy();
  });

  it('renders an N/A note for measures missing from the comparison schema', () => {
    renderPane('game:bls', {
      mergedRows: [],
      compLabel: 'Game: bls',
      unavailableMeasures: ['recharge.revenue_vnd'],
    });
    expect(screen.getByText(/N\/A/)).toBeTruthy();
  });
});
