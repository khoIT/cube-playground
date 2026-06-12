/**
 * Redirect-matrix tests for the Catalog dispatch (catalog-page.tsx) after the
 * Cubes surface took over the bare /catalog/data-model URL:
 *   1. root + ?focus=        → /data-model/schema (chat field-chip deep links)
 *   2. /data-model/cubes     → root + ?view=grid  (legacy grid bookmarks)
 *   3. /catalog/cubes        → chains through 2
 *   4. /catalog/schema?focus → /data-model/schema, search preserved
 * Every subtab surface is stubbed — these tests pin the routing only.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CatalogPage } from '../catalog-page';

vi.mock('../../../hooks', () => ({ useCubeApiBootstrap: () => {} }));
vi.mock('../use-catalog-meta', () => ({
  useCatalogMeta: () => ({ cubes: [], loading: false, error: null }),
}));
vi.mock('../catalog-tabs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../catalog-tabs')>();
  return { ...actual, DataModelSubtabs: () => <nav data-testid="subtabs" /> };
});
vi.mock('../cube-graph/cubes-surface', () => ({
  CubesSurface: () => <div data-testid="cubes-surface" />,
}));
vi.mock('../schema-cartographer/cartographer-page', () => ({
  SchemaCartographerPage: () => <div data-testid="cartographer" />,
}));
vi.mock('../data-model-tab/data-model-tab', () => ({ DataModelTab: () => <div /> }));
vi.mock('../catalog-browse-body', () => ({ CatalogBrowseBody: () => <div /> }));
vi.mock('../../Schema/SchemaPage', () => ({ SchemaPage: () => <div /> }));
vi.mock('../concept-detail/concept-detail-page', () => ({ ConceptDetailPage: () => <div /> }));
vi.mock('../digest/digest-page', () => ({ DigestPage: () => <div /> }));
vi.mock('../metric-composition-wizard/composition-wizard-page', () => ({
  MetricCompositionWizard: () => <div />,
}));
vi.mock('../notifications/notifications-page', () => ({ NotificationsPage: () => <div /> }));
vi.mock('../saved-views/saved-views-page', () => ({ SavedViewsPage: () => <div /> }));
vi.mock('../workspaces/workspaces-page', () => ({ WorkspacesPage: () => <div /> }));
vi.mock('../metric-detail/metric-detail-page', () => ({ MetricDetailPage: () => <div /> }));
vi.mock('../metrics-tab/metrics-tab', () => ({ MetricsTab: () => <div /> }));
vi.mock('../glossary/glossary-index-page', () => ({ GlossaryIndexPage: () => <div /> }));

function renderAt(entry: string) {
  let resolved = '';
  render(
    <MemoryRouter initialEntries={[entry]}>
      <CatalogPage />
      <Route
        path="*"
        render={({ location }) => {
          resolved = `${location.pathname}${location.search}`;
          return null;
        }}
      />
    </MemoryRouter>,
  );
  return { resolvedUrl: () => resolved };
}

describe('Data Model redirect matrix', () => {
  it('lands the bare root on the Cubes surface (Graph default)', () => {
    const { resolvedUrl } = renderAt('/catalog/data-model');
    expect(screen.getByTestId('cubes-surface')).toBeTruthy();
    expect(resolvedUrl()).toBe('/catalog/data-model');
  });

  it('keeps the Cubes surface for root + ?view=grid', () => {
    renderAt('/catalog/data-model?view=grid');
    expect(screen.getByTestId('cubes-surface')).toBeTruthy();
  });

  it('redirects root + ?focus= to the Schema subtab, preserving the search', () => {
    const { resolvedUrl } = renderAt('/catalog/data-model?focus=mf_users.user_id');
    expect(screen.getByTestId('cartographer')).toBeTruthy();
    expect(resolvedUrl()).toBe('/catalog/data-model/schema?focus=mf_users.user_id');
  });

  it('redirects the legacy /catalog/schema?focus= chain into /data-model/schema', () => {
    const { resolvedUrl } = renderAt('/catalog/schema?focus=mf_users.user_id');
    expect(screen.getByTestId('cartographer')).toBeTruthy();
    expect(resolvedUrl()).toBe('/catalog/data-model/schema?focus=mf_users.user_id');
  });

  it('redirects the legacy grid bookmark /catalog/data-model/cubes to root ?view=grid', () => {
    const { resolvedUrl } = renderAt('/catalog/data-model/cubes');
    expect(screen.getByTestId('cubes-surface')).toBeTruthy();
    expect(resolvedUrl()).toBe('/catalog/data-model?view=grid');
  });

  it('chains the oldest /catalog/cubes URL through to root ?view=grid', () => {
    const { resolvedUrl } = renderAt('/catalog/cubes');
    expect(screen.getByTestId('cubes-surface')).toBeTruthy();
    expect(resolvedUrl()).toBe('/catalog/data-model?view=grid');
  });

  it('renders the Cartographer at /catalog/data-model/schema without focus', () => {
    const { resolvedUrl } = renderAt('/catalog/data-model/schema');
    expect(screen.getByTestId('cartographer')).toBeTruthy();
    expect(resolvedUrl()).toBe('/catalog/data-model/schema');
  });
});
