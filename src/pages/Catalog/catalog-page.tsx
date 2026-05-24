/**
 * Catalog routing host. Since the Hermes shell port (260523) the top-level
 * Data Model vs Metrics Catalog split lives in the sidebar — there is no
 * catalog-wide page header here. Inside /catalog/data-model the user can
 * subnav between Concepts / Cubes / Models. /catalog/metrics renders the
 * business-metric registry directly.
 *
 * Long-tail surfaces (Digest / Notifications / Saved views / Workspaces)
 * remain reachable via direct URL even though they no longer appear in the
 * sidebar.
 */
import { useMemo, useState } from 'react';
import { Redirect, Route, useLocation, withRouter } from 'react-router-dom';
import styled from 'styled-components';

import { SchemaPage } from '../Schema/SchemaPage';
import { CatalogGrid } from './catalog-grid';
import { CatalogToolbar } from './catalog-toolbar';
import { ConceptDetailPage } from './concept-detail/concept-detail-page';
import { DataModelSubtabs, resolveDataModelSubtab } from './catalog-tabs';
import { DataModelTab } from './data-model-tab/data-model-tab';
import { DigestPage } from './digest/digest-page';
import { MetricCompositionWizard } from './metric-composition-wizard/composition-wizard-page';
import { NotificationsPage } from './notifications/notifications-page';
import { SavedViewsPage } from './saved-views/saved-views-page';
import { WorkspacesPage } from './workspaces/workspaces-page';
import { DetailPanel } from './detail-panel';
import { MetricDetailPage } from './metric-detail/metric-detail-page';
import { MetricsTab } from './metrics-tab/metrics-tab';
import { useCatalogMeta, CatalogCube } from './use-catalog-meta';
import { useCubeClusters } from './use-cube-clusters';
import { SchemaCartographerPage } from './schema-cartographer/cartographer-page';
import { GlossaryIndexPage } from './glossary/glossary-index-page';
import { useCubeApiBootstrap } from '../../hooks';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const Main = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 32px;
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

type CatalogBrowseBodyProps = {
  cubes: CatalogCube[];
  loading: boolean;
  error: string | null;
};

function CatalogBrowseBody({ cubes, loading, error }: CatalogBrowseBodyProps) {
  const [search, setSearch] = useState('');
  const [hasPreAggOnly, setHasPreAggOnly] = useState(false);
  const [selectedCube, setSelectedCube] = useState<string | null>(null);
  const clusters = useCubeClusters(cubes);

  const filteredClusters = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (c: CatalogCube): boolean => {
      if (q) {
        const hit = (s: string | undefined) => s?.toLowerCase().includes(q) ?? false;
        if (!(hit(c.name) || hit(c.title) || hit(c.description))) return false;
      }
      if (hasPreAggOnly && (c.preAggregations?.length ?? 0) === 0) return false;
      return true;
    };
    return {
      connected: clusters.connected
        .map((group) => group.filter(matches))
        .filter((g) => g.length > 0),
      standalone: clusters.standalone.filter(matches),
    };
  }, [clusters, search, hasPreAggOnly]);

  const selected = useMemo(
    () => cubes.find((c) => c.name === selectedCube) ?? null,
    [cubes, selectedCube],
  );

  return (
    <>
      {error && <StatusLine $kind="error">Failed to load meta: {error}</StatusLine>}
      {loading && <StatusLine $kind="info">Loading…</StatusLine>}

      <CatalogToolbar
        search={search}
        onSearchChange={setSearch}
        hasPreAggOnly={hasPreAggOnly}
        onHasPreAggToggle={() => setHasPreAggOnly((v) => !v)}
      />

      <Body>
        <Main>
          {!loading && !error && (
            <CatalogGrid
              clusters={filteredClusters}
              onSelect={(name) => setSelectedCube(name)}
              selected={selectedCube}
            />
          )}
        </Main>

        {selected && <DetailPanel cube={selected} onClose={() => setSelectedCube(null)} />}
      </Body>
    </>
  );
}

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
  // remain reachable via direct URL. Schema cartographer moved into the
  // Data Model subtabs as the default landing; the old /catalog/schema URL
  // (used by chat field-chips before the move) preserves its `?focus=` param
  // through the redirect.
  if (location.pathname === '/catalog/schema') {
    const search = location.search ?? '';
    return <Redirect to={`/catalog/data-model${search}`} />;
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

  // Metrics Catalog — single surface, no subtabs.
  if (location.pathname === '/catalog/metrics' || location.pathname.startsWith('/catalog/metrics/')) {
    return (
      <Page>
        <MetricsTab />
      </Page>
    );
  }

  // Data Model surface with Schema / Concepts / Cubes / Models subtabs.
  // Schema is the leftmost tab and the default landing (renders at the bare
  // /catalog/data-model URL); other subtabs hang off /concepts /cubes /models.
  const subtab = resolveDataModelSubtab(location.pathname) ?? 'schema';
  return (
    <Page>
      <DataModelSubtabs />
      {subtab === 'schema' && <SchemaCartographerPage />}
      {subtab === 'concepts' && <DataModelTab />}
      {subtab === 'cubes' && (
        <CatalogBrowseBody cubes={cubes} loading={loading} error={error} />
      )}
      {subtab === 'models' && (
        <ModelsHost>
          <SchemaPageWithRouter />
        </ModelsHost>
      )}
    </Page>
  );
}
