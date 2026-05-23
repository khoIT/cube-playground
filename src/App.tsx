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
import { ChatOverlay } from './shell/chat-overlay/chat-overlay';
import { ChatPanel } from './shell/chat-overlay/chat-panel';
import { useChatSurfaces } from './shell/chat-overlay/use-chat-surfaces';
import { setOpen } from './shell/chat-overlay/chat-panel-open-store';
import { TopbarTrailingProvider } from './shell/topbar/topbar-trailing-context';
import { TopbarBreadcrumbProvider } from './shell/topbar/topbar-breadcrumb-context';
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
      // 5 s timeout — a hung TCP connection (server accepts but never replies)
      // would otherwise leave the splash up forever, because plain `await fetch`
      // never throws on hang. AbortController turns the hang into a catchable
      // error so we fall through to buildFallbackContext().
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch('playground/context', { signal: controller.signal });
        if (res.ok) {
          context = await res.json();
        }
      } finally {
        clearTimeout(timer);
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
            <TopbarBreadcrumbProvider>
              <CubeTokenBootstrap />
              <ShellLayout fatalError={fatalError}>{children}</ShellLayout>
              <SmartSearchOverlay />
              <RecentItemPusher />
            </TopbarBreadcrumbProvider>
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
  const { panelVisible } = useChatSurfaces();

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
      {/* Chat panel is a flex sibling so it pushes main content (not an overlay). */}
      {panelVisible && <ChatPanel onClose={() => setOpen(false)} />}
      {/* FAB renders fixed-position inside ChatOverlay — not part of the flex row. */}
      <ChatOverlay />
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
    // Only concept detail visits (measure/dimension/segment) feed the Data
    // Model recents — the cube/model sub-tab routes share the same prefix
    // and would otherwise push literal "cubes" / "models" strings.
    const concept = location.pathname.match(/^\/catalog\/concept\/[^/]+\/([^/]+)/);
    if (concept) {
      pushRecent('data-model', {
        id: concept[1],
        title: concept[1],
        updatedAt: new Date().toISOString(),
        href: location.pathname,
      });
    }
    // Segments + business-metric recents are pushed by their respective detail
    // pages once data loads, so titles are real names (not raw UUIDs / ids).
    const metric = location.pathname.match(/^\/catalog\/metric\/([^/]+)/);
    if (metric && metric[1] !== 'new') {
      const metricId = metric[1];
      // Business-metric ids are slugs (no dots). Anything dotted is a Cube
      // measure / dimension ref that leaked through a redirect — route those
      // to the Data Model recents tray instead of polluting Metrics Catalog.
      const looksLikeCubeRef = metricId.includes('.');
      pushRecent(looksLikeCubeRef ? 'data-model' : 'metrics-catalog', {
        id: metricId,
        title: metricId,
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
