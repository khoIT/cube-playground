/**
 * Catalog routing host. Since the Hermes shell port (260523) the top-level
 * Data Model vs Metrics Catalog split lives in the sidebar — there is no
 * catalog-wide page header here. Inside /catalog/data-model the user can
 * subnav between Cubes (join graph + card grid, default) / Schema / Concepts /
 * Models / Concept Map. /catalog/metrics renders the business-metric registry
 * directly.
 *
 * Long-tail surfaces (Digest / Notifications / Saved views / Workspaces)
 * remain reachable via direct URL even though they no longer appear in the
 * sidebar.
 */
import { lazy, Suspense } from 'react';
import { Redirect, Route, useLocation, withRouter } from 'react-router-dom';
import styled from 'styled-components';

import { SchemaPage } from '../Schema/SchemaPage';
import { CatalogBrowseBody } from './catalog-browse-body';
import { ConceptDetailPage } from './concept-detail/concept-detail-page';
import { DataModelSubtabs, resolveDataModelSubtab } from './catalog-tabs';
import { DataModelTab } from './data-model-tab/data-model-tab';
import { DigestPage } from './digest/digest-page';
import { MetricCompositionWizard } from './metric-composition-wizard/composition-wizard-page';
import { NotificationsPage } from './notifications/notifications-page';
import { SavedViewsPage } from './saved-views/saved-views-page';
import { WorkspacesPage } from './workspaces/workspaces-page';
import { MetricDetailPage } from './metric-detail/metric-detail-page';
import { MetricsTab } from './metrics-tab/metrics-tab';
import { CubesSurface } from './cube-graph/cubes-surface';
import { useCatalogMeta } from './use-catalog-meta';
import { SchemaCartographerPage } from './schema-cartographer/cartographer-page';
import { GlossaryIndexPage } from './glossary/glossary-index-page';
import { useCubeApiBootstrap } from '../../hooks';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
`;

const ModelsHost = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
`;

const StatusLine = styled.div<{ $kind: 'info' | 'error' }>`
  padding: 16px 32px;
  font-size: 13px;
  color: ${(p) => (p.$kind === 'error' ? 'var(--danger)' : 'var(--text-muted)')};
`;

const SchemaPageWithRouter = withRouter(SchemaPage);

// Code-split the concept-map subtab: its reactflow canvas (~45kb) loads only
// when the tab is opened, keeping it out of the main Catalog bundle.
const ConceptMapPage = lazy(() => import('./concept-map/concept-map-page'));

export function CatalogPage() {
  const location = useLocation();
  // Without this, /catalog/metric/:id rendered before /build leaves apiUrl
  // + token null; useCatalogMeta then bails and the "Open in Explore"
  // right-rail can't pick a per-cube time dim from /meta.
  useCubeApiBootstrap();
  const { cubes, loading, error } = useCatalogMeta();

  // Composition wizard short-circuit — /catalog/metric/new must run before
  // the /catalog/metric/:id detail pattern below.
  if (location.pathname === '/catalog/metric/new') {
    return (
      <Page>
        <MetricCompositionWizard />
      </Page>
    );
  }

  // Long-tail surfaces — sidebar entries removed (260523-1347) but the routes
  // remain reachable via direct URL. Schema cartographer lives at the
  // /data-model/schema subtab; the old /catalog/schema URL (used by chat
  // field-chips before the move) preserves its `?focus=` param through the
  // redirect.
  if (location.pathname === '/catalog/schema') {
    const search = location.search ?? '';
    return <Redirect to={`/catalog/data-model/schema${search}`} />;
  }
  const longTailMap: Record<string, JSX.Element> = {
    '/catalog/digest':        <DigestPage />,
    '/catalog/notifications': <NotificationsPage />,
    '/catalog/saved-views':   <SavedViewsPage />,
    '/catalog/workspaces':    <WorkspacesPage />,
    '/catalog/glossary':      <GlossaryIndexPage />,
  };
  if (longTailMap[location.pathname]) {
    return <Page>{longTailMap[location.pathname]}</Page>;
  }

  // Detail pages own their chrome.
  if (/^\/catalog\/metric\/[^/]+/.test(location.pathname)) {
    return (
      <Page>
        <Route path="/catalog/metric/:id">
          <MetricDetailPage />
        </Route>
      </Page>
    );
  }
  if (/^\/catalog\/concept\/[^/]+\/[^/]+/.test(location.pathname)) {
    return (
      <Page>
        <Route path="/catalog/concept/:type/:fqn">
          <ConceptDetailPage />
        </Route>
      </Page>
    );
  }

  // Legacy top-level paths fold into the new IA: Data Model owns Cubes + Models
  // as subtabs; /catalog (root) defers to the sidebar's default landing.
  if (location.pathname === '/catalog/cubes') return <Redirect to="/catalog/data-model/cubes" />;
  if (location.pathname === '/catalog/models') return <Redirect to="/catalog/data-model/models" />;
  if (location.pathname === '/catalog') return <Redirect to="/catalog/data-model" />;

  // The Cubes surface owns the bare /catalog/data-model URL (Graph default).
  // Two legacy shapes still need rerouting:
  //  - root + ?focus= → Schema Cartographer (chat field-chips deep-link the
  //    root from when Schema owned it; keep the full search string).
  //  - /data-model/cubes (old grid bookmark) → root with ?view=grid.
  if (location.pathname === '/catalog/data-model') {
    const params = new URLSearchParams(location.search);
    if (params.has('focus')) {
      return <Redirect to={`/catalog/data-model/schema${location.search}`} />;
    }
  }
  if (location.pathname === '/catalog/data-model/cubes') {
    return <Redirect to="/catalog/data-model?view=grid" />;
  }

  // Metrics Catalog — single surface, no subtabs.
  if (location.pathname === '/catalog/metrics' || location.pathname.startsWith('/catalog/metrics/')) {
    return (
      <Page>
        <MetricsTab />
      </Page>
    );
  }

  // Data Model surface with Cubes / Schema / Concepts / Models / Concept Map
  // subtabs. Cubes is the leftmost tab and the default landing (renders at
  // the bare /catalog/data-model URL, Graph view by default); other subtabs
  // hang off /schema /concepts /models /concept-map.
  const subtab = resolveDataModelSubtab(location.pathname) ?? 'cubes';
  return (
    <Page>
      <DataModelSubtabs />
      {subtab === 'cubes' && <CubesSurface cubes={cubes} loading={loading} error={error} />}
      {subtab === 'schema' && <SchemaCartographerPage />}
      {subtab === 'concept-map' && (
        <Suspense fallback={<StatusLine $kind="info">Loading…</StatusLine>}>
          <ConceptMapPage />
        </Suspense>
      )}
      {subtab === 'concepts' && <DataModelTab />}
      {subtab === 'models' && (
        <ModelsHost>
          <SchemaPageWithRouter />
        </ModelsHost>
      )}
    </Page>
  );
}
