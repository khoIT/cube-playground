import ReactDOM from 'react-dom';
import { ReactNode, Suspense, useRef } from 'react';
import { Router, Route, Redirect, useLocation, useParams } from 'react-router-dom';
import { createHashHistory } from 'history';

import App from './App';
import { page } from './events';
import {
  ExplorePage,
  IndexPage,
  CatalogPage,
  SegmentsPage,
} from './pages';
import { loadable } from './loadable';
import { CubeLoader } from './atoms';
import { SecurityContextProvider } from './components/SecurityContext/SecurityContextProvider';
import { AppContextProvider } from './components/AppContext';
import { GameContextProvider } from './components/Header/use-game-context';
import { ThemeProvider } from './theme/ThemeContext';
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
            <Suspense fallback={<CubeLoader />}>
              <Route key="index" exact path="/" component={IndexPage} />
              <KeepAliveRoute key="build" path="/build">
                <ExplorePage />
              </KeepAliveRoute>
              <Route key="schema-redirect" exact path="/schema">
                <Redirect to="/catalog/models" />
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
              <Route key="data-model-new-success" exact path="/data-model/new/success" component={DataModelWizardSuccess} />
              <Route key="data-model-new" path="/data-model/new" component={DataModelWizardPage} />
              <Route key="metrics-new-success-legacy" exact path="/metrics/new/success">
                <Redirect to="/data-model/new/success" />
              </Route>
              <Route key="metrics-new-legacy" path="/metrics/new">
                <Redirect to="/data-model/new?v=2" />
              </Route>
            </Suspense>
          </App>
        </SecurityContextProvider>
      </ThemeProvider>
      </GameContextProvider>
    </AppContextProvider>
  </Router>,
  // eslint-disable-next-line no-undef
  document.getElementById('root')
);
