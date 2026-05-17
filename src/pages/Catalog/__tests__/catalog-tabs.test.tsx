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
  it('marks Catalog active at /catalog', () => {
    renderTabs('/catalog');
    const catalog = screen.getByRole('tab', { name: 'Catalog' });
    const models = screen.getByRole('tab', { name: 'Models' });
    expect(catalog.getAttribute('aria-selected')).toBe('true');
    expect(models.getAttribute('aria-selected')).toBe('false');
  });

  it('marks Models active at /catalog/models', () => {
    renderTabs('/catalog/models');
    const catalog = screen.getByRole('tab', { name: 'Catalog' });
    const models = screen.getByRole('tab', { name: 'Models' });
    expect(models.getAttribute('aria-selected')).toBe('true');
    expect(catalog.getAttribute('aria-selected')).toBe('false');
  });

  it('navigates to /catalog/models when Models tab clicked from /catalog', () => {
    const { getPath } = renderTabs('/catalog');
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    expect(getPath()).toBe('/catalog/models');
  });

  it('navigates back to /catalog when Catalog tab clicked', () => {
    const { getPath } = renderTabs('/catalog/models');
    fireEvent.click(screen.getByRole('tab', { name: 'Catalog' }));
    expect(getPath()).toBe('/catalog');
  });
});
