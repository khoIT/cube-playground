/* eslint-disable no-undef,react/jsx-no-target-blank */
import '@ant-design/compatible/assets/index.css';
import './theme/tokens.css';
import './theme/antd-overrides.css';
import { Alert } from 'antd';
import { Component, PropsWithChildren, useEffect, useState } from 'react';
import { RouteComponentProps, useLocation, withRouter } from 'react-router-dom';
import { Root } from '@cube-dev/ui-kit';

import { CubeLoader } from './atoms';
import { AppContextConsumer, PlaygroundContext } from './components/AppContext';
import GlobalStyles from './components/GlobalStyles';
import { GamePicker } from './components/Header/game-picker';
import { WorkspaceProvider } from './components/workspace-context';
import { WorkspaceSwitcher } from './shell/topbar/workspace-switcher';
import { SmartSearchOverlay } from './shared/smart-search/smart-search-overlay';
import { SmartSearchProvider, useSmartSearch } from './shared/smart-search/smart-search-context';
import { ChatSearchOverlay } from './shared/chat-search/chat-search-overlay';
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
import { useServerPrefsBootstrap } from './hooks/use-server-pref';
import { useAuthUser } from './auth/auth-context';
import { QUERY_BUILDER_COLOR_TOKENS } from './QueryBuilderV2';
import { Sidebar } from './shell/sidebar/sidebar';
import { SidebarEdgeToggle } from './shell/sidebar/sidebar-edge-toggle';
import { getCollapsed, onCollapsedChange } from './shell/sidebar/sidebar-collapsed-store';
import { T } from './shell/theme';
import { Topbar } from './shell/topbar/topbar';
import { ChatOverlay } from './shell/chat-overlay/chat-overlay';
import { ChatPanel } from './shell/chat-overlay/chat-panel';
import { useChatSurfaces } from './shell/chat-overlay/use-chat-surfaces';
import { setOpen } from './shell/chat-overlay/chat-panel-open-store';
import { CubeApiBanner } from './shell/cube-api-banner';
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
    // /cube-api — workspace-aware proxy on Fastify (forwards to the right
    // Cube based on the active x-cube-workspace header). The legacy
    // /cubejs-api path still works for direct-to-Cube callers but bypasses
    // workspace switching.
    basePath: '/cube-api',
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
    // Force the workspace-aware Fastify proxy regardless of what
    // `playground/context` reports. The legacy Cube endpoint at :4000 still
    // advertises `basePath: '/cubejs-api'`, which would bypass workspace
    // routing entirely.
    context.basePath = '/cube-api';

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

        <WorkspaceProvider>
          <SmartSearchProvider>
            <TopbarTrailingProvider>
              <TopbarBreadcrumbProvider>
                <CubeTokenBootstrap />
                <ServerPrefsBootstrap />
                <ShellLayout fatalError={fatalError}>{children}</ShellLayout>
                <SmartSearchOverlay />
                <ChatSearchOverlay />
                <RecentItemPusher />
              </TopbarBreadcrumbProvider>
            </TopbarTrailingProvider>
          </SmartSearchProvider>
        </WorkspaceProvider>
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
  // Mirror the sidebar's collapse state so the edge toggle's chevron points the
  // right way. Read synchronously on mount (no width flash) and subscribe to the
  // shared store event so both this and <Sidebar/> stay in sync.
  const [collapsed, setCollapsedState] = useState<boolean>(() => getCollapsed());
  useEffect(() => onCollapsedChange(setCollapsedState), []);

  return (
    <div style={{
      height: '100vh', overflow: 'hidden',
      // Warm frame cream. Backs the panels and shows through as the gutter
      // between the query-builder panel and the chat (panels are a step lighter).
      background: T.sidebar,
      display: 'flex', flexDirection: 'row', alignItems: 'stretch',
      padding: 0, gap: 0, boxSizing: 'border-box',
    }}>
      <Sidebar />
      {/* Seam is invisible at rest so the sidebar + topbar read as one warm
          surface; the collapse circle only appears on hover. */}
      <SidebarEdgeToggle collapsed={collapsed} />
      {/* Right column: warm topbar stacked over the content row. */}
      <div style={{
        flex: 1, minWidth: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        background: T.sidebar, overflow: 'hidden',
      }}>
        <Topbar
          onSearchOpen={smartSearch.open}
          fixedTrailing={
            <>
              <WorkspaceSwitcher />
              <GamePicker />
            </>
          }
        />
        {/* Content row: query-builder panel + chat panel start below the topbar.
            The 8px gap shows the darker shell tone as a gutter between them. */}
        <div style={{
          flex: 1, minWidth: 0, minHeight: 0,
          display: 'flex', flexDirection: 'row', gap: 8,
        }}>
          <main style={{
            flex: 1, minWidth: 0, minHeight: 0,
            display: 'flex', flexDirection: 'column',
            // Lighter warm content panel (a step lighter than the frame cream):
            // rounded top corners + hairline top/left/right border separate it
            // from the frame; the gutter shows the frame cream.
            background: T.panel,
            borderTop: `1px solid ${T.n200}`,
            borderLeft: `1px solid ${T.n200}`,
            borderRight: `1px solid ${T.n200}`,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            overflow: 'hidden',
          }}>
            <CubeApiBanner />
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
          {/* Chat panel is a flex sibling of <main> (not full shell height) so it
              pushes main content and starts where the content panel starts. */}
          {panelVisible && <ChatPanel onClose={() => setOpen(false)} />}
        </div>
      </div>
      {/* Side-effect host: listens for game-change to close the panel. */}
      <ChatOverlay />
    </div>
  );
}

function CubeTokenBootstrap() {
  useCubeTokenBootstrap();
  return null;
}

// Pulls the owner's server-side preferences into the local mirror once the
// authenticated identity is known, and imports any pre-migration local values.
function ServerPrefsBootstrap() {
  const user = useAuthUser();
  useServerPrefsBootstrap(user?.id ?? null);
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

  // Playground recents are pushed by QueryTabs (which owns the tab id used
  // as the Q-number) — keeping the push there is the only way to guarantee
  // the sidebar "Q3" and the in-page "Query 3" tab refer to the same query.

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
