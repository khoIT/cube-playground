/* eslint-disable no-undef,react/jsx-no-target-blank */
import '@ant-design/compatible/assets/index.css';
import './theme/tokens.css';
import './theme/antd-overrides.css';
import { Alert } from 'antd';
import { Component, PropsWithChildren, useEffect } from 'react';
import { RouteComponentProps, useLocation, withRouter } from 'react-router-dom';
import { Root } from '@cube-dev/ui-kit';

import { CubeLoader } from './atoms';
import { AppContextConsumer, PlaygroundContext } from './components/AppContext';
import GlobalStyles from './components/GlobalStyles';
import { GamePicker } from './components/Header/game-picker';
import { SmartSearchOverlay } from './shared/smart-search/smart-search-overlay';
import { SmartSearchProvider, useSmartSearch } from './shared/smart-search/smart-search-context';
// useTopbarTrailing is consumed by page components; importing here only to
// keep TypeScript happy about the unused-export check is unnecessary.
import {
  event,
  setAnonymousId,
  setTelemetry,
  setTracker,
  trackImpl,
} from './events';
import { useAppContext } from './hooks';
import { useCubeTokenBootstrap } from './hooks/use-cube-token-bootstrap';
import { QUERY_BUILDER_COLOR_TOKENS } from './QueryBuilderV2';
import { Sidebar } from './shell/sidebar/sidebar';
import { T } from './shell/theme';
import { Topbar } from './shell/topbar/topbar';
import { TopbarTrailingProvider } from './shell/topbar/topbar-trailing-context';
import { pushRecent } from './shell/sidebar/recent-items-store';
import { rootStyles } from './theme/ui-kit-theme';

type AppState = {
  fatalError: Error | null;
  context: PlaygroundContext | null;
  showLoader: boolean;
  isAppContextSet: boolean;
};

const ROOT_STYLES = {
  ...rootStyles,
  ...QUERY_BUILDER_COLOR_TOKENS,
};

function buildFallbackContext(): PlaygroundContext {
  const envToken: string = (import.meta as any).env?.VITE_CUBE_TOKEN || '';
  const lsToken = (typeof window !== 'undefined' && window.localStorage.getItem('gds-cube:token')) || '';
  return {
    anonymousId: 'gds-cube',
    cubejsToken: lsToken || envToken,
    basePath: '/cubejs-api',
    isDocker: false,
    dbType: null,
    telemetry: false,
    shouldStartConnectionWizardFlow: false,
    dockerVersion: null,
    identifier: 'gds-cube',
    previewFeatures: false,
    serverCoreVersion: '1.0.0',
    coreServerVersion: '1.0.0',
    isCloud: false,
    livePreview: false,
  } as PlaygroundContext;
}

class App extends Component<PropsWithChildren<RouteComponentProps>, AppState> {
  static getDerivedStateFromError(error) {
    return { fatalError: error };
  }

  state: AppState = {
    fatalError: null,
    context: null,
    showLoader: false,
    isAppContextSet: false,
  };

  async componentDidMount() {
    setTimeout(() => this.setState({ showLoader: true }), 700);

    window.addEventListener('unhandledrejection', (promiseRejectionEvent) => {
      const error = promiseRejectionEvent.reason;
      console.log(error);
      const e = (error.stack || error).toString();
      event('Playground Error', { error: e });
    });

    let context: PlaygroundContext | null = null;
    try {
      const res = await fetch('playground/context');
      if (res.ok) {
        context = await res.json();
      }
    } catch {
      // ignore — falls through to fallback
    }

    if (!context) {
      context = buildFallbackContext();
    }

    setTelemetry(context.telemetry);
    setTracker(trackImpl);
    setAnonymousId(context.anonymousId, {
      coreServerVersion: context.coreServerVersion,
      projectFingerprint: (context as any).projectFingerprint,
      isDocker: Boolean(context.isDocker),
      dockerVersion: context.dockerVersion,
    });

    this.setState({ context });
  }

  componentDidCatch(error, info) {
    event('Playground Error', {
      error: (error.stack || error).toString(),
      info: info.toString(),
    });
  }

  render() {
    const { children } = this.props;
    const { context, fatalError, isAppContextSet, showLoader } = this.state;

    if (context != null && !isAppContextSet) {
      return (
        <>
          <ContextSetter context={context} />
          <AppContextConsumer
            onReady={() => this.setState({ isAppContextSet: true })}
          />
        </>
      );
    }

    if (context == null && !isAppContextSet) {
      return showLoader ? <CubeLoader /> : null;
    }

    if (fatalError) {
      console.log(fatalError.stack);
    }

    return (
      <Root publicUrl="." styles={ROOT_STYLES}>
        <GlobalStyles />

        <SmartSearchProvider>
          <TopbarTrailingProvider>
            <CubeTokenBootstrap />
            <ShellLayout fatalError={fatalError}>{children}</ShellLayout>
            <SmartSearchOverlay />
            <RecentItemPusher />
          </TopbarTrailingProvider>
        </SmartSearchProvider>
      </Root>
    );
  }
}

type ShellLayoutProps = PropsWithChildren<{
  fatalError: Error | null;
}>;

function ShellLayout({ fatalError, children }: ShellLayoutProps) {
  const smartSearch = useSmartSearch();
  return (
    <div style={{
      height: '100vh', overflow: 'hidden',
      background: T.shell,
      display: 'flex', flexDirection: 'row', alignItems: 'stretch',
      padding: 10, gap: 8, boxSizing: 'border-box',
    }}>
      <Sidebar />
      <main style={{
        flex: 1, minWidth: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        background: T.surface, borderRadius: 18, overflow: 'hidden',
      }}>
        <Topbar onSearchOpen={smartSearch.open} fixedTrailing={<GamePicker />} />
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
          {fatalError ? (
            <Alert
              message="Error occured while rendering"
              description={fatalError.stack || ''}
              type="error"
            />
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}

function CubeTokenBootstrap() {
  useCubeTokenBootstrap();
  return null;
}

function RecentItemPusher() {
  const location = useLocation();
  useEffect(() => {
    const dm = location.pathname.match(/^\/catalog\/data-model\/([^/]+)/);
    if (dm) {
      pushRecent('data-model', { id: dm[1], title: dm[1], updatedAt: new Date().toISOString() });
    }
    // Concepts (measures/dimensions/segments) live in the Data Model surface,
    // so concept-detail visits feed the Data Model recents — not metrics catalog.
    const concept = location.pathname.match(/^\/catalog\/concept\/[^/]+\/([^/]+)/);
    if (concept) {
      pushRecent('data-model', {
        id: concept[1],
        title: concept[1],
        updatedAt: new Date().toISOString(),
        href: location.pathname,
      });
    }
    const seg = location.pathname.match(/^\/segments\/([^/]+)/);
    if (seg && seg[1] !== 'identity-map' && seg[1] !== 'new') {
      pushRecent('segments', { id: seg[1], title: seg[1], updatedAt: new Date().toISOString() });
    }
    // Business-metric detail pages — those are Metrics Catalog entries.
    const metric = location.pathname.match(/^\/catalog\/metric\/([^/]+)/);
    if (metric && metric[1] !== 'new') {
      pushRecent('metrics-catalog', {
        id: metric[1],
        title: metric[1],
        updatedAt: new Date().toISOString(),
        href: location.pathname,
      });
    }
  }, [location.pathname]);
  return null;
}

type ContextSetterProps = {
  context: PlaygroundContext;
};

function ContextSetter({ context }: ContextSetterProps) {
  const { setContext } = useAppContext();

  useEffect(() => {
    if (context !== null) {
      setContext({
        ready: true,
        playgroundContext: {
          ...context,
          isCloud: false,
        },
        identifier: context.identifier,
      });
    }
  }, [context]);

  return null;
}

export default withRouter(App);
