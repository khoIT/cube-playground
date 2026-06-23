/**
 * Search + scroll behavior for the game-picker dropdown body (<GameMenu>).
 *
 * The prod workspace exposes ~65 games; the picker must stay usable. These
 * tests render the presentational menu directly (no provider chain — it only
 * needs the i18n singleton) and assert:
 *   1. A short roster shows no search box (search would be noise under 8 games).
 *   2. A long roster shows the search box and filters by id OR display name.
 *   3. A query with no hits renders the empty state, not a blank list.
 *   4. Selecting a filtered row fires onSelect with that game's id.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import i18n from '../../../i18n';
import { GameMenu } from '../game-picker';
import type { GameDef } from '../../../types/segment-api';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const make = (n: number): GameDef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `game_${i}`, name: `Game ${i}` }));

const prodLike: GameDef[] = [
  { id: 'cfm_vn', name: 'CrossFire Mobile VN' },
  { id: 'jus_vn', name: 'Justice VN' },
  { id: 'ballistar', name: 'Ballistar' },
  { id: 'ballistar_twid', name: 'ballistar_twid' },
  ...make(12),
];

function renderMenu(games: GameDef[], onSelect = vi.fn()) {
  render(<GameMenu games={games} gameId="cfm_vn" onSelect={onSelect} label="Active game" />);
  return onSelect;
}

describe('GameMenu search', () => {
  it('hides the search box for a short roster', () => {
    renderMenu(make(8));
    expect(screen.queryByPlaceholderText('Search games…')).toBeNull();
  });

  it('shows the search box once the roster is long', () => {
    renderMenu(prodLike);
    expect(screen.getByPlaceholderText('Search games…')).toBeTruthy();
  });

  it('filters by display name', () => {
    renderMenu(prodLike);
    fireEvent.change(screen.getByPlaceholderText('Search games…'), {
      target: { value: 'justice' },
    });
    expect(screen.getByText('Justice VN')).toBeTruthy();
    expect(screen.queryByText('CrossFire Mobile VN')).toBeNull();
  });

  it('filters by raw id (id-only games are findable by their slug)', () => {
    renderMenu(prodLike);
    fireEvent.change(screen.getByPlaceholderText('Search games…'), {
      target: { value: 'twid' },
    });
    // both the named ballistar and ballistar_twid contain "ballistar", but only
    // ballistar_twid's id contains "twid" (it renders the slug as name + id).
    expect(screen.getAllByText('ballistar_twid').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ballistar')).toBeNull();
  });

  it('renders the empty state when nothing matches', () => {
    renderMenu(prodLike);
    fireEvent.change(screen.getByPlaceholderText('Search games…'), {
      target: { value: 'zzzznope' },
    });
    expect(screen.getByText(/No games match/)).toBeTruthy();
  });

  it('fires onSelect with the id of a filtered row', () => {
    const onSelect = renderMenu(prodLike);
    fireEvent.change(screen.getByPlaceholderText('Search games…'), {
      target: { value: 'justice' },
    });
    fireEvent.click(screen.getByText('Justice VN'));
    expect(onSelect).toHaveBeenCalledWith('jus_vn');
  });
});
