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
  it('marks Cubes active at /catalog/data-model (default landing)', () => {
    renderTabs('/catalog/data-model');
    expect(
      screen.getByRole('tab', { name: 'Cubes' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'Concepts' }).getAttribute('aria-selected'),
    ).toBe('false');
    expect(
      screen.getByRole('tab', { name: 'Schema' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('marks Concepts active at /catalog/data-model/concepts', () => {
    renderTabs('/catalog/data-model/concepts');
    expect(
      screen.getByRole('tab', { name: 'Concepts' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('marks Schema active at /catalog/data-model/schema', () => {
    renderTabs('/catalog/data-model/schema');
    expect(
      screen.getByRole('tab', { name: 'Schema' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('marks Concept Map active at /catalog/data-model/concept-map', () => {
    renderTabs('/catalog/data-model/concept-map');
    expect(
      screen.getByRole('tab', { name: 'Concept Map' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('renders subtabs in order: Cubes, Schema, Concepts, Concept Map', () => {
    renderTabs('/catalog/data-model');
    const tabs = screen.getAllByRole('tab').map((el) => el.textContent);
    expect(tabs).toEqual(['Cubes', 'Schema', 'Concepts', 'Concept Map']);
  });

  it('navigates to /catalog/data-model/concepts when Concepts clicked', () => {
    const { getPath } = renderTabs('/catalog/data-model');
    fireEvent.click(screen.getByRole('tab', { name: 'Concepts' }));
    expect(getPath()).toBe('/catalog/data-model/concepts');
  });

  it('navigates back to /catalog/data-model (Cubes) when Cubes clicked', () => {
    const { getPath } = renderTabs('/catalog/data-model/schema');
    fireEvent.click(screen.getByRole('tab', { name: 'Cubes' }));
    expect(getPath()).toBe('/catalog/data-model');
  });

  it('navigates to /catalog/data-model/schema when Schema clicked', () => {
    const { getPath } = renderTabs('/catalog/data-model');
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect(getPath()).toBe('/catalog/data-model/schema');
  });
});

describe('resolveDataModelSubtab', () => {
  it('returns cubes for /catalog/data-model (default)', () => {
    expect(resolveDataModelSubtab('/catalog/data-model')).toBe('cubes');
  });

  it('returns schema for /catalog/data-model/schema', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/schema')).toBe('schema');
  });

  it('returns concepts for /catalog/data-model/concepts', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/concepts')).toBe('concepts');
  });

  it('returns cubes for the legacy /catalog/data-model/cubes subpath', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/cubes')).toBe('cubes');
  });

  it('falls back to cubes for the retired /catalog/data-model/models subpath', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/models')).toBe('cubes');
  });

  it('returns concept-map for /catalog/data-model/concept-map', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/concept-map')).toBe('concept-map');
  });

  it('does not confuse concept-map with the concepts subtab', () => {
    expect(resolveDataModelSubtab('/catalog/data-model/concept-map')).not.toBe('concepts');
    expect(resolveDataModelSubtab('/catalog/data-model/concepts')).toBe('concepts');
  });

  it('returns null for non-data-model paths', () => {
    expect(resolveDataModelSubtab('/catalog/metrics')).toBeNull();
    expect(resolveDataModelSubtab('/segments')).toBeNull();
  });
});
