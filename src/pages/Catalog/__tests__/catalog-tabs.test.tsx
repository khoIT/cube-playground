import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import i18n from '../../../i18n';
import { DataModelSubtabs, resolveDataModelSubtab } from '../catalog-tabs';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function renderTabs(pathname: string) {
  let currentPath = pathname;
  const utils = render(
    <MemoryRouter initialEntries={[pathname]}>
      <DataModelSubtabs />
      <Route
        path="*"
        render={({ location }) => {
          currentPath = location.pathname;
          return <div data-testid="cur-path">{location.pathname}</div>;
        }}
      />
    </MemoryRouter>,
  );
  return { ...utils, getPath: () => currentPath };
}

describe('<DataModelSubtabs>', () => {
  it('marks Concepts active at /catalog/data-model', () => {
    renderTabs('/catalog/data-model');
    expect(
      screen.getByRole('tab', { name: 'Concepts' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'Cubes' }).getAttribute('aria-selected'),
    ).toBe('false');
    expect(
      screen.getByRole('tab', { name: 'Models' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('marks Cubes active at /catalog/data-model/cubes', () => {
    renderTabs('/catalog/data-model/cubes');
    expect(
      screen.getByRole('tab', { name: 'Cubes' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('marks Models active at /catalog/data-model/models', () => {
    renderTabs('/catalog/data-model/models');
    expect(
      screen.getByRole('tab', { name: 'Models' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('renders subtabs in order: Concepts, Cubes, Models', () => {
    renderTabs('/catalog/data-model');
    const tabs = screen.getAllByRole('tab').map((el) => el.textContent);
    expect(tabs).toEqual(['Concepts', 'Cubes', 'Models']);
  });

  it('navigates to /catalog/data-model/cubes when Cubes clicked', () => {
    const { getPath } = renderTabs('/catalog/data-model');
    fireEvent.click(screen.getByRole('tab', { name: 'Cubes' }));
    expect(getPath()).toBe('/catalog/data-model/cubes');
  });

  it('navigates back to /catalog/data-model (Concepts) when Concepts clicked', () => {
    const { getPath } = renderTabs('/catalog/data-model/cubes');
    fireEvent.click(screen.getByRole('tab', { name: 'Concepts' }));
    expect(getPath()).toBe('/catalog/data-model');
  });
});

describe('resolveDataModelSubtab', () => {
  it('returns concepts for /catalog/data-model', () => {
    expect(resolveDataModelSubtab('/catalog/data-model')).toBe('concepts');
  });

  it('returns cubes for /catalog/data-model/cubes', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/cubes')).toBe('cubes');
  });

  it('returns models for /catalog/data-model/models', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/models')).toBe('models');
  });

  it('returns null for non-data-model paths', () => {
    expect(resolveDataModelSubtab('/catalog/metrics')).toBeNull();
    expect(resolveDataModelSubtab('/segments')).toBeNull();
  });
});
