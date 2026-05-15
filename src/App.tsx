/* eslint-disable no-undef,react/jsx-no-target-blank */
import '@ant-design/compatible/assets/index.css';
import { Alert, Layout } from 'antd';
import { Component, PropsWithChildren, useEffect } from 'react';
import { RouteComponentProps, withRouter } from 'react-router-dom';
import styled from 'styled-components';
import { Root } from '@cube-dev/ui-kit';

import { CubeLoader } from './atoms';
import { AppContextConsumer, PlaygroundContext } from './components/AppContext';
import GlobalStyles from './components/GlobalStyles';
import Header from './components/Header/Header';
import {
  event,
  setAnonymousId,
  setTelemetry,
  setTracker,
  trackImpl,
} from './events';
import { useAppContext } from './hooks';
import { QUERY_BUILDER_COLOR_TOKENS } from './QueryBuilderV2';

const StyledLayoutContent = styled(Layout.Content)`
  height: 100%;
`;

type AppState = {
  fatalError: Error | null;
  context: PlaygroundContext | null;
  showLoader: boolean;
  isAppContextSet: boolean;
};

const ROOT_STYLES = {
  height: 'min 100vh',
  display: 'grid',
  gridTemplateRows: 'min-content 1fr',
  ...QUERY_BUILDER_COLOR_TOKENS,
};

// GDS Cube bootstrap context — built when /playground/context is unavailable
// (production-style Cube backend). We use env + localStorage for the JWT and
// default basePath '/cubejs-api'. The Security Context modal in the header
// lets the user override the token at runtime.
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
      // Cube dev-mode contract: GET /playground/context returns {anonymousId, cubejsToken, basePath, ...}.
      // We try it first to preserve faithful behavior against a Cube dev server.
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
    const { location, children } = this.props;
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

        <Header selectedKeys={[location.pathname]} />

        <StyledLayoutContent>
          {fatalError ? (
            <Alert
              message="Error occured while rendering"
              description={fatalError.stack || ''}
              type="error"
            />
          ) : (
            children
          )}
        </StyledLayoutContent>
      </Root>
    );
  }
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
