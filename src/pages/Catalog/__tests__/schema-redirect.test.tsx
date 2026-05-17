import { render, screen } from '@testing-library/react';
import { MemoryRouter, Redirect, Route, Switch } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

function renderApp(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Switch>
        <Route exact path="/schema">
          <Redirect to="/catalog/models" />
        </Route>
        <Route path="/catalog/models">
          <div data-testid="models-page">Models</div>
        </Route>
        <Route path="/catalog">
          <div data-testid="catalog-page">Catalog</div>
        </Route>
      </Switch>
    </MemoryRouter>,
  );
}

describe('/schema redirect', () => {
  it('redirects /schema → /catalog/models', () => {
    renderApp('/schema');
    expect(screen.getByTestId('models-page')).toBeTruthy();
  });

  it('renders catalog at /catalog directly', () => {
    renderApp('/catalog');
    expect(screen.getByTestId('catalog-page')).toBeTruthy();
  });

  it('renders models tab at /catalog/models', () => {
    renderApp('/catalog/models');
    expect(screen.getByTestId('models-page')).toBeTruthy();
  });
});
