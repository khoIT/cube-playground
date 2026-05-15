import ReactDOM from 'react-dom';
import { Router, Route } from 'react-router-dom';
import { createHashHistory } from 'history';

import App from './App';
import { page } from './events';
import {
  ExplorePage,
  SchemaPage,
  IndexPage,
} from './pages';
import { SecurityContextProvider } from './components/SecurityContext/SecurityContextProvider';
import { AppContextProvider } from './components/AppContext';

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

ReactDOM.render(
  <Router history={history}>
    <AppContextProvider
      playgroundContext={{
        isCloud: false,
      }}
    >
      <App>
        <Route key="index" exact path="/" component={IndexPage} />
        <Route
          key="build"
          path="/build"
          component={(props) => {
            return (
              <SecurityContextProvider
                onTokenPayloadChange={onTokenPayloadChange}
              >
                <ExplorePage {...props} />
              </SecurityContextProvider>
            );
          }}
        />
        <Route key="schema" path="/schema" component={SchemaPage} />
      </App>
    </AppContextProvider>
  </Router>,
  // eslint-disable-next-line no-undef
  document.getElementById('root')
);
