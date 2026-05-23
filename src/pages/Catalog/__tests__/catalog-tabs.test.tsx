import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import i18n from '../../../i18n';
import { CatalogTabs } from '../catalog-tabs';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function renderTabs(pathname: string) {
  let currentPath = pathname;
  const { rerender, ...rest } = render(
    <MemoryRouter initialEntries={[pathname]}>
      <CatalogTabs />
      <Route
        path="*"
        render={({ location }) => {
          currentPath = location.pathname;
          return <div data-testid="cur-path">{location.pathname}</div>;
        }}
      />
    </MemoryRouter>,
  );
  return { rerender, ...rest, getPath: () => currentPath };
}

describe('<CatalogTabs>', () => {
  it('marks Metrics active at /catalog', () => {
    renderTabs('/catalog');
    expect(
      screen.getByRole('tab', { name: 'Metrics' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'Models' }).getAttribute('aria-selected'),
    ).toBe('false');
    expect(
      screen.getByRole('tab', { name: 'Cubes' }).getAttribute('aria-selected'),
    ).toBe('false');
    expect(
      screen.getByRole('tab', { name: 'Data Model' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('marks Cubes active at /catalog/cubes', () => {
    renderTabs('/catalog/cubes');
    expect(
      screen.getByRole('tab', { name: 'Cubes' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'Metrics' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('marks Data Model active at /catalog/data-model', () => {
    renderTabs('/catalog/data-model');
    expect(
      screen.getByRole('tab', { name: 'Data Model' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('marks Models active at /catalog/models', () => {
    renderTabs('/catalog/models');
    expect(
      screen.getByRole('tab', { name: 'Models' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('renders tabs in order: Metrics, Data Model, Cubes, Models', () => {
    renderTabs('/catalog');
    const tabs = screen.getAllByRole('tab').map((el) => el.textContent);
    expect(tabs).toEqual(['Metrics', 'Data Model', 'Cubes', 'Models']);
  });

  it('navigates to /catalog/data-model when Data Model clicked', () => {
    const { getPath } = renderTabs('/catalog');
    fireEvent.click(screen.getByRole('tab', { name: 'Data Model' }));
    expect(getPath()).toBe('/catalog/data-model');
  });

  it('navigates to /catalog/cubes when Cubes clicked', () => {
    const { getPath } = renderTabs('/catalog');
    fireEvent.click(screen.getByRole('tab', { name: 'Cubes' }));
    expect(getPath()).toBe('/catalog/cubes');
  });

  it('navigates back to /catalog (Metrics) when Metrics clicked from /catalog/cubes', () => {
    const { getPath } = renderTabs('/catalog/cubes');
    fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
    expect(getPath()).toBe('/catalog');
  });
});
