import ReactDOM from 'react-dom';
import { ReactNode, useRef } from 'react';
import { Router, Route, withRouter } from 'react-router-dom';
import { createHashHistory } from 'history';

import App from './App';
import { page } from './events';
import {
  ExplorePage,
  SchemaPage,
  IndexPage,
  CatalogPage,
  MetricCardPage,
} from './pages';
import { NewMetricPage } from './QueryBuilderV2/NewMetric/full-page/NewMetricPage';
import { NewMetricSuccess } from './QueryBuilderV2/NewMetric/full-page/steps/success/success-body';
import { SecurityContextProvider } from './components/SecurityContext/SecurityContextProvider';
import { AppContextProvider } from './components/AppContext';

const SchemaPageWithRouter = withRouter(SchemaPage);

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
// when inactive — only one wrapper is visible at a time.
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
      <App>
        <Route key="index" exact path="/" component={IndexPage} />
        <KeepAliveRoute key="build" path="/build">
          <SecurityContextProvider onTokenPayloadChange={onTokenPayloadChange}>
            <ExplorePage />
          </SecurityContextProvider>
        </KeepAliveRoute>
        <KeepAliveRoute key="schema" path="/schema">
          <SchemaPageWithRouter />
        </KeepAliveRoute>
        <KeepAliveRoute key="catalog" path="/catalog">
          <CatalogPage />
        </KeepAliveRoute>
        <KeepAliveRoute key="metric" path="/metric/:cube/:member">
          <MetricCardPage />
        </KeepAliveRoute>
        <Route key="metrics-new-success" exact path="/metrics/new/success" component={NewMetricSuccess} />
        <Route key="metrics-new" path="/metrics/new" component={NewMetricPage} />
      </App>
    </AppContextProvider>
  </Router>,
  // eslint-disable-next-line no-undef
  document.getElementById('root')
);
