import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import {
  MemoryRouter,
  Route,
  Redirect,
  useLocation,
  useParams,
} from 'react-router-dom';
import { describe, expect, it } from 'vitest';

function LegacyMetricRedirect() {
  const { cube, member } = useParams<{ cube: string; member: string }>();
  const location = useLocation();
  return (
    <Redirect
      to={`/catalog/concept/measure/${cube}.${member}${location.search}${location.hash}`}
    />
  );
}

function PathDisplay() {
  const location = useLocation();
  return (
    <div data-testid="resolved-path">
      {`${location.pathname}${location.search}${location.hash}`}
    </div>
  );
}

function harness(entry: string): ReactNode {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Route path="/metric/:cube/:member">
        <LegacyMetricRedirect />
      </Route>
      <Route path="*">
        <PathDisplay />
      </Route>
    </MemoryRouter>
  );
}

describe('LegacyMetricRedirect', () => {
  it('rewrites /metric/:cube/:member to /catalog/concept/measure/cube.member', () => {
    render(harness('/metric/orders/revenue_vnd'));
    expect(screen.getByTestId('resolved-path').textContent).toBe(
      '/catalog/concept/measure/orders.revenue_vnd',
    );
  });

  it('preserves query string in the redirect target', () => {
    render(harness('/metric/orders/revenue_vnd?foo=1'));
    expect(screen.getByTestId('resolved-path').textContent).toBe(
      '/catalog/concept/measure/orders.revenue_vnd?foo=1',
    );
  });

  it('preserves hash fragment in the redirect target', () => {
    render(harness('/metric/orders/revenue_vnd#anchor'));
    expect(screen.getByTestId('resolved-path').textContent).toBe(
      '/catalog/concept/measure/orders.revenue_vnd#anchor',
    );
  });
});
