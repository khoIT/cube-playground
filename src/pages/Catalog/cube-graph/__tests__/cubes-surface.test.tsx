/**
 * CubesSurface tests — Graph is the default view, ?view=grid selects the card
 * grid, and the toggle rewrites the URL via history.replace while preserving
 * unrelated query params (the view must always derive from the location, not
 * one-shot state, so KeepAliveRoute back-nav can't show a stale view).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CubesSurface } from '../cubes-surface';

vi.mock('../../catalog-browse-body', () => ({
  CatalogBrowseBody: () => <div data-testid="grid-view" />,
}));

vi.mock('../cube-graph-page', () => ({
  default: () => <div data-testid="graph-view" />,
}));

function renderAt(entry: string) {
  let resolved = '';
  let entriesLength = 0;
  render(
    <MemoryRouter initialEntries={[entry]}>
      <CubesSurface cubes={[]} loading={false} error={null} />
      <Route
        path="*"
        render={({ location, history }) => {
          resolved = `${location.pathname}${location.search}`;
          entriesLength = history.length;
          return null;
        }}
      />
    </MemoryRouter>,
  );
  return { resolvedUrl: () => resolved, historyLength: () => entriesLength };
}

describe('CubesSurface', () => {
  it('renders the Graph view by default', async () => {
    renderAt('/catalog/data-model');
    expect(await screen.findByTestId('graph-view')).toBeTruthy();
    expect(screen.queryByTestId('grid-view')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Graph' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('renders the Grid view for ?view=grid', () => {
    renderAt('/catalog/data-model?view=grid');
    expect(screen.getByTestId('grid-view')).toBeTruthy();
    expect(screen.queryByTestId('graph-view')).toBeNull();
  });

  it('toggling to Grid uses history.replace (no history spam) and sets ?view=grid', async () => {
    const { resolvedUrl, historyLength } = renderAt('/catalog/data-model');
    const before = historyLength();
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    await waitFor(() => expect(screen.getByTestId('grid-view')).toBeTruthy());
    expect(resolvedUrl()).toBe('/catalog/data-model?view=grid');
    expect(historyLength()).toBe(before);
  });

  it('toggling back to Graph drops ?view but keeps unrelated params', async () => {
    const { resolvedUrl } = renderAt('/catalog/data-model?view=grid&game=cfm');
    fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
    expect(await screen.findByTestId('graph-view')).toBeTruthy();
    expect(resolvedUrl()).toBe('/catalog/data-model?game=cfm');
  });
});
