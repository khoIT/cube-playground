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
    noDimensionOverlap: false,
    comparisonRows: [],
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
      // A real paired comparison has comparison rows (these feed the __cmp values).
      comparisonRows: [
        {
          'recharge.os_platform': 'IOS',
          'recharge.recharge_date.week': '2026-05-04T00:00:00.000',
          'recharge.revenue_vnd': 514_000_000,
        },
      ],
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

  it('renders side-by-side leaderboards (current + comparison game) when dims do not overlap', () => {
    renderPane('game:bls', {
      mergedRows: [
        { 'recharge.os_platform': 'IOS', 'recharge.revenue_vnd': 500 } as MergedRow,
      ],
      comparisonRows: [{ 'recharge.os_platform': 'CFM-TOP', 'recharge.revenue_vnd': 999 }],
      compLabel: 'Game: bls',
      noDimensionOverlap: true,
    });
    // Heads-up explains the side-by-side (not the old "no comparable rows").
    expect(screen.getByText(/Showing each game’s own top rows side by side/)).toBeTruthy();
    // The paired grouped-bar header is gone.
    expect(screen.queryByText(/current vs/)).toBeNull();
    // Both leaderboards render: the current row label AND the comparison game's.
    expect(screen.getByText('IOS')).toBeTruthy();
    expect(screen.getByText('CFM-TOP')).toBeTruthy();
    // Column header carries the friendly game name + a "Current" column.
    expect(screen.getByText('Current')).toBeTruthy();
    // "Ballistar" appears in both the heads-up note and the column header.
    expect(screen.getAllByText('Ballistar').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a "no data" note (not empty paired bars) when the comparison game returned no rows', () => {
    renderPane('game:bls', {
      mergedRows: [
        { 'recharge.os_platform': 'IOS', 'recharge.revenue_vnd': 500 } as MergedRow,
      ],
      comparisonRows: [], // target game has no rows for this query/range
      compLabel: 'Game: bls',
      noDimensionOverlap: false,
    });
    expect(screen.getByText(/has no data for this query/)).toBeTruthy();
    // The misleading paired grouped-bar view is suppressed.
    expect(screen.queryByText(/current vs/)).toBeNull();
  });
});
