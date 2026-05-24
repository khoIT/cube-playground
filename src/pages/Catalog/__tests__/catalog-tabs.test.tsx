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
  it('marks Schema active at /catalog/data-model (default landing)', () => {
    renderTabs('/catalog/data-model');
    expect(
      screen.getByRole('tab', { name: 'Schema' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'Concepts' }).getAttribute('aria-selected'),
    ).toBe('false');
    expect(
      screen.getByRole('tab', { name: 'Cubes' }).getAttribute('aria-selected'),
    ).toBe('false');
    expect(
      screen.getByRole('tab', { name: 'Models' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('marks Concepts active at /catalog/data-model/concepts', () => {
    renderTabs('/catalog/data-model/concepts');
    expect(
      screen.getByRole('tab', { name: 'Concepts' }).getAttribute('aria-selected'),
    ).toBe('true');
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

  it('renders subtabs in order: Schema, Concepts, Cubes, Models', () => {
    renderTabs('/catalog/data-model');
    const tabs = screen.getAllByRole('tab').map((el) => el.textContent);
    expect(tabs).toEqual(['Schema', 'Concepts', 'Cubes', 'Models']);
  });

  it('navigates to /catalog/data-model/concepts when Concepts clicked', () => {
    const { getPath } = renderTabs('/catalog/data-model');
    fireEvent.click(screen.getByRole('tab', { name: 'Concepts' }));
    expect(getPath()).toBe('/catalog/data-model/concepts');
  });

  it('navigates back to /catalog/data-model (Schema) when Schema clicked', () => {
    const { getPath } = renderTabs('/catalog/data-model/cubes');
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect(getPath()).toBe('/catalog/data-model');
  });
});

describe('resolveDataModelSubtab', () => {
  it('returns schema for /catalog/data-model (default)', () => {
    expect(resolveDataModelSubtab('/catalog/data-model')).toBe('schema');
  });

  it('returns concepts for /catalog/data-model/concepts', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/concepts')).toBe('concepts');
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
