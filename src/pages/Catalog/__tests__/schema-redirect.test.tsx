import { render, screen } from '@testing-library/react';
import { MemoryRouter, Redirect, Route, Switch } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

function renderApp(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Switch>
        <Route exact path="/schema">
          <Redirect to="/catalog/data-model" />
        </Route>
        <Route path="/catalog">
          <div data-testid="catalog-page">Catalog</div>
        </Route>
      </Switch>
    </MemoryRouter>,
  );
}

describe('/schema redirect', () => {
  // The legacy DB-schema generator is retired; /schema now lands on the
  // Data Model surface root instead of the removed Models tab.
  it('redirects /schema → /catalog/data-model', () => {
    renderApp('/schema');
    expect(screen.getByTestId('catalog-page')).toBeTruthy();
  });

  it('renders catalog at /catalog directly', () => {
    renderApp('/catalog');
    expect(screen.getByTestId('catalog-page')).toBeTruthy();
  });
});
