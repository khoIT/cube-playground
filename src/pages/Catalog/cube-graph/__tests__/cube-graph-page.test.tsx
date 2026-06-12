/**
 * CubeGraphPage integration tests — page-level logic with the reactflow board
 * stubbed (the canvas doesn't measure in jsdom; same approach as the
 * concept-map page tests). Asserts the props the page feeds the board
 * (dim sets, selection) plus toolbar wiring and DetailPanel opening.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CubeGraphPage from '../cube-graph-page';
import type { CatalogCube } from '../../use-catalog-meta';
import type { JoinGraph } from '../build-join-graph';

const CUBES: CatalogCube[] = [
  { name: 'mf_users', title: 'Users', type: 'cube', measures: [], dimensions: [] },
  {
    name: 'etl_login',
    title: 'Logins',
    type: 'cube',
    measures: [],
    dimensions: [],
    joins: [{ name: 'mf_users', relationship: 'belongsTo', sql: '`${CUBE}.uid = ${mf_users}.user_id`' }],
  },
  { name: 'game_key_metrics', title: 'Key metrics', type: 'cube', measures: [], dimensions: [] },
  {
    name: 'user_360',
    title: 'User 360',
    type: 'view',
    measures: [],
    dimensions: [{ name: 'user_360.uid', aliasMember: 'mf_users.user_id' }],
  },
];

vi.mock('../../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'cfm',
}));

vi.mock('../../../../components/workspace-context', () => ({
  useWorkspaceContext: () => ({ workspaceId: 'local', workspace: { gameModel: 'game_id' } }),
}));

vi.mock('../../detail-panel', () => ({
  DetailPanel: ({ cube, onClose }: { cube: CatalogCube; onClose: () => void }) => (
    <aside data-testid="detail-panel" data-cube={cube.name}>
      <button data-testid="close-panel" onClick={onClose}>
        close
      </button>
    </aside>
  ),
}));

vi.mock('../cube-graph-board', () => ({
  CubeGraphBoard: (props: {
    graph: JoinGraph;
    selected: string | null;
    dimmed: ReadonlySet<string>;
    onSelect: (name: string | null) => void;
  }) => (
    <div
      data-testid="board"
      data-nodecount={props.graph.nodes.length}
      data-edgecount={props.graph.edges.length}
      data-selected={props.selected ?? ''}
      data-dimmed={[...props.dimmed].sort().join(',')}
    >
      <button data-testid="select-login" onClick={() => props.onSelect('etl_login')}>
        select etl_login
      </button>
    </div>
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('CubeGraphPage', () => {
  it('builds the graph from non-view cubes and renders the board', () => {
    render(<CubeGraphPage cubes={CUBES} loading={false} error={null} />);
    const board = screen.getByTestId('board');
    expect(board.getAttribute('data-nodecount')).toBe('3');
    expect(board.getAttribute('data-edgecount')).toBe('1');
  });

  it('opens the DetailPanel for the clicked cube and closes it again', async () => {
    render(<CubeGraphPage cubes={CUBES} loading={false} error={null} />);
    expect(screen.queryByTestId('detail-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('select-login'));
    await waitFor(() => {
      expect(screen.getByTestId('detail-panel').getAttribute('data-cube')).toBe('etl_login');
    });
    fireEvent.click(screen.getByTestId('close-panel'));
    await waitFor(() => expect(screen.queryByTestId('detail-panel')).toBeNull());
  });

  it('dims non-matching cubes while searching', async () => {
    render(<CubeGraphPage cubes={CUBES} loading={false} error={null} />);
    expect(screen.getByTestId('board').getAttribute('data-dimmed')).toBe('');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'login' } });
    await waitFor(() =>
      expect(screen.getByTestId('board').getAttribute('data-dimmed')).toBe(
        'game_key_metrics,mf_users',
      ),
    );
  });

  it('dims cubes outside the highlighted view', async () => {
    render(<CubeGraphPage cubes={CUBES} loading={false} error={null} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user_360' } });
    await waitFor(() =>
      expect(screen.getByTestId('board').getAttribute('data-dimmed')).toBe(
        'etl_login,game_key_metrics',
      ),
    );
  });

  it('shows the lint chip and cycles selection through flagged cubes', async () => {
    render(<CubeGraphPage cubes={CUBES} loading={false} error={null} />);
    const chip = screen.getByRole('button', { name: /isolated/ });
    expect(chip.textContent).toContain('1 isolated');
    fireEvent.click(chip);
    await waitFor(() =>
      expect(screen.getByTestId('board').getAttribute('data-selected')).toBe('game_key_metrics'),
    );
  });
});
