import ReactDOM from 'react-dom';
import { ReactNode, Suspense, useRef } from 'react';
import { Router, Route, Redirect, useLocation, useParams } from 'react-router-dom';
import { createHashHistory } from 'history';

import App from './App';
import { page } from './events';
import {
  ExplorePage,
  CatalogPage,
  SegmentsPage,
  SettingsPage,
} from './pages';
import { loadable } from './loadable';
import { CubeLoader } from './atoms';
import { SecurityContextProvider } from './components/SecurityContext/SecurityContextProvider';
import { AppContextProvider } from './components/AppContext';
import { GameContextProvider } from './components/Header/use-game-context';
import { ThemeProvider } from './theme/ThemeContext';
import { AuthProvider, useAuthUser } from './auth/auth-context';
import { AuthGate } from './auth/auth-gate';
import { FeatureOpenBeacon } from './api/feature-open-beacon-mount';
import './i18n';

// The wizard at `/data-model/new` is the YAML data-model builder
// (artifactKind: measure | dimension | segment). Renamed from `/metrics/new`
// to reflect what it actually does. Lightweight business-metric registration
// lives at `/catalog/metric/new` (AddMetricPage).
const DataModelWizardPage = loadable(() =>
  import('./QueryBuilderV2/NewMetric/full-page/NewMetricPage').then((m) => ({
    default: m.NewMetricPage,
  }))
);

const DataModelWizardSuccess = loadable(() =>
  import('./QueryBuilderV2/NewMetric/full-page/steps/success/success-body').then(
    (m) => ({ default: m.NewMetricSuccess })
  )
);

const ChatThreadPage = loadable(() =>
  import('./pages/Chat/chat-thread-page').then((m) => ({
    default: m.ChatThreadPage,
  }))
);

const DevAuditShell = loadable(() =>
  import('./pages/DevAudit/dev-audit-shell').then((m) => ({
    default: m.DevAuditShell,
  }))
);

const LiveopsPage = loadable(() =>
  import('./pages/Liveops').then((m) => ({ default: m.LiveopsPage }))
);

const AnomalyInboxPage = loadable(() =>
  import('./pages/Liveops/anomaly-inbox').then((m) => ({ default: m.AnomalyInboxPage }))
);

const CohortRetentionPage = loadable(() =>
  import('./pages/Liveops/cohort').then((m) => ({ default: m.CohortRetentionPage }))
);

const DashboardsListPage = loadable(() =>
  import('./pages/Dashboards').then((m) => ({ default: m.DashboardsListPage }))
);

const DashboardDetailPage = loadable(() =>
  import('./pages/Dashboards/dashboard-detail').then((m) => ({ default: m.DashboardDetailPage }))
);

const AdminAccessPage = loadable(() =>
  import('./pages/Admin/access').then((m) => ({ default: m.AdminAccessPage }))
);

const AdminHub = loadable(() =>
  import('./pages/Admin/hub').then((m) => ({ default: m.AdminHub }))
);

const DriftCenterPage = loadable(() =>
  import('./pages/DriftCenter').then((m) => ({ default: m.DriftCenterPage }))
);

const DataHubPage = loadable(() =>
  import('./pages/Data').then((m) => ({ default: m.DataHubPage }))
);

// Admin-only route guard. Renders the page only for role 'admin' (matching the
// server's necessary condition), otherwise bounces to '/'. The server also
// enforces this on every /api/admin/* call — this guard is convenience only.
function AdminAccessRoute() {
  const user = useAuthUser();
  if (user?.role !== 'admin') return <Redirect to="/" />;
  return <AdminAccessPage />;
}

// Hub guard: covers /admin, /admin/access, /admin/observability, /admin/dev.
// AdminHub's internal TabShell + Switch handle the sub-route rendering.
// The legacy /admin/access exact route is preserved via AdminHub's own Switch
// (resolveTab maps the pathname to the correct tab automatically).
function AdminHubRoute() {
  const user = useAuthUser();
  if (user?.role !== 'admin') return <Redirect to="/" />;
  return <AdminHub />;
}


const history = createHashHistory();
history.listen((location) => {
  const { search, ...props } = location;
  page(props);
});

// GDS Cube: client-only token bootstrap. The dev /playground/token endpoint may
// not exist in production-style backends, so we just keep whatever the user
// pasted via the Security Context modal.
async function onTokenPayloadChange(_payload: Record<string, any>, token) {
  if (token != null) {
    return token;
  }
  try {
    const response = await fetch('playground/token', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: _payload }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    return json.token;
  } catch {
    return null;
  }
}

// Render-prop Routes keep these pages MOUNTED across navigation once visited so
// their internal React state (query result set, executed query, sql, durations,
// page selections) survives when the user switches to a sibling tab and back.
// Pages are lazy-mounted on first match, then stay mounted with display:none
// when inactive — only one wrapper is visible at a time. Phase 5.E removes
// this once cubeApi + mutexRef are promoted to the Zustand store.
function LegacyMetricRedirect() {
  const { cube, member } = useParams<{ cube: string; member: string }>();
  const location = useLocation();
  return (
    <Redirect
      to={`/catalog/concept/measure/${cube}.${member}${location.search}${location.hash}`}
    />
  );
}

function KeepAliveRoute({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const mountedRef = useRef(false);
  return (
    <Route path={path}>
      {({ match }) => {
        if (match) mountedRef.current = true;
        if (!mountedRef.current) return null;
        return (
          <div style={{ display: match ? 'contents' : 'none' }}>{children}</div>
        );
      }}
    </Route>
  );
}

ReactDOM.render(
  <AuthProvider>
    <AuthGate>
      <Router history={history}>
        <AppContextProvider
          playgroundContext={{
            isCloud: false,
          }}
        >
          <GameContextProvider>
      <ThemeProvider>
        <SecurityContextProvider onTokenPayloadChange={onTokenPayloadChange}>
          <App>
            <FeatureOpenBeacon />
            <Suspense fallback={<CubeLoader />}>
              <Route key="index" exact path="/">
                <Redirect to="/chat" />
              </Route>
              {/* Single mount across /chat and /chat/:id so state persists
                  across the `new → session_created → /chat/<id>` transition. */}
              <Route key="chat-thread" path="/chat/:id?" component={ChatThreadPage} />
              {/* DevAuditShell handles all /dev/chat-audit/* routes including legacy redirects */}
              <Route key="dev-audit" path="/dev/chat-audit" component={DevAuditShell} />
              <KeepAliveRoute key="build" path="/build">
                <ExplorePage />
              </KeepAliveRoute>
              <Route key="schema-redirect" exact path="/schema">
                <Redirect to="/catalog/models" />
              </Route>
              <Route key="catalog-default" exact path="/catalog">
                <Redirect to="/catalog/data-model" />
              </Route>
              <KeepAliveRoute key="catalog" path="/catalog">
                <CatalogPage />
              </KeepAliveRoute>
              <Route key="metric-redirect" path="/metric/:cube/:member">
                <LegacyMetricRedirect />
              </Route>
              <KeepAliveRoute key="segments" path="/segments">
                <SegmentsPage />
              </KeepAliveRoute>
              <Route key="liveops-anomalies" exact path="/liveops/anomalies" component={AnomalyInboxPage} />
              <Route key="liveops-cohort" exact path="/liveops/cohort" component={CohortRetentionPage} />
              <Route key="liveops" exact path="/liveops" component={LiveopsPage} />
              <Route key="dashboards-detail" exact path="/dashboards/:slug" component={DashboardDetailPage} />
              <Route key="dashboards" exact path="/dashboards" component={DashboardsListPage} />
              <Route key="drift-center" exact path="/drift-center" component={DriftCenterPage} />
              <Route key="data-hub" exact path="/data" component={DataHubPage} />
              <Route key="settings" exact path="/settings" component={SettingsPage} />
              {/*
                AdminHub covers /admin, /admin/access, /admin/observability, /admin/dev.
                Using path (not exact) so TabShell's Switch can match sub-routes.
                resolveTab resolves /admin/access → 'access' tab correctly.
                The old AdminAccessPage + AdminAccessRoute are kept for the Settings
                "Access" link — lower-risk than changing the Settings nav target,
                and both share the same underlying components. They will converge
                in a follow-up once Settings nav is updated to point to /admin/access.
              */}
              <Route key="admin-hub" path="/admin" component={AdminHubRoute} />
              <Route key="data-model-new-success" exact path="/data-model/new/success" component={DataModelWizardSuccess} />
              <Route key="data-model-new" exact path="/data-model/new" component={DataModelWizardPage} />
              <Route key="metrics-new-success-legacy" exact path="/metrics/new/success">
                <Redirect to="/data-model/new/success" />
              </Route>
              <Route key="metrics-new-legacy" exact path="/metrics/new">
                <Redirect to="/data-model/new?v=2" />
              </Route>
            </Suspense>
          </App>
        </SecurityContextProvider>
      </ThemeProvider>
          </GameContextProvider>
        </AppContextProvider>
      </Router>
    </AuthGate>
  </AuthProvider>,
  // eslint-disable-next-line no-undef
  document.getElementById('root')
);
