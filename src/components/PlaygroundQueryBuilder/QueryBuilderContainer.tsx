import { Panel, Space } from '@cube-dev/ui-kit';
import { CubeProvider } from '@cubejs-client/react';
import { Card, message } from 'antd';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import styled from 'styled-components';

import { CubeLoader } from '../../atoms';
import { useActiveGameId } from '../Header/use-game-context';
import { useAppContext, useCubejsApi, useSecurityContext } from '../../hooks';
import {
  OPEN_ROLLUP_DESIGNER_EVENT,
  RollupDesignerContext,
  useRollupDesignerContext,
} from '../../rollup-designer';
import { applyGameFilter } from '../../shared/game-scoping/apply-game-filter';
import { normalizeQueryRelativeDateRanges } from '../../QueryBuilderV2/utils/normalize-relative-date-range';
import { ChartRendererStateProvider } from '../QueryTabs/ChartRendererStateProvider';
import { QueryTabs, QueryTabsProps } from '../QueryTabs/QueryTabs';
import {
  QueryBuilder,
  QueryBuilderProps,
  RequestStatusProps,
} from '../../QueryBuilderV2/index';

import { PreAggregationStatus } from './components/index';
import { PlaygroundVizard } from './playground-vizard';

const StyledCard = styled(Card)`
  border-radius: 0;
  border-bottom: 1px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--layout-body-background);
  zoom: 0.88;

  & .ant-card-body {
    padding: 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
`;

function RequestStatusComponent({
  isAggregated,
  external,
  extDbType,
  preAggregationType,
}: RequestStatusProps) {
  return (
    <Space direction="vertical" gap="0" placeItems="end" margin="-1x 0">
      <PreAggregationStatus
        preAggregationType={preAggregationType}
        isAggregated={isAggregated}
        external={external}
        extDbType={extDbType}
      />
    </Space>
  );
}

type QueryBuilderContainerProps = Pick<
  QueryBuilderProps,
  | 'defaultQuery'
  | 'initialVizState'
  | 'schemaVersion'
  | 'extra'
  | 'onSchemaChange'
  | 'onQueryChange'
> &
  Pick<QueryTabsProps, 'onTabChange'>;

export function QueryBuilderContainer(props: QueryBuilderContainerProps) {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();

  useLayoutEffect(() => {
    if (apiUrl && currentToken) {
      window['__cubejsPlayground'] = {
        ...window['__cubejsPlayground'],
        apiUrl,
        token: currentToken,
      };
    }
  }, [apiUrl, currentToken]);

  const cubejsApi = useCubejsApi(apiUrl, currentToken);

  if (!cubejsApi) {
    return <CubeLoader />;
  }

  return (
    <CubeProvider cubeApi={cubejsApi}>
      <RollupDesignerContext apiUrl={apiUrl!}>
        <ChartRendererStateProvider>
          <StyledCard bordered={false}>
            <QueryTabsRenderer
              cubejsApi={cubejsApi}
              apiUrl={apiUrl!}
              token={currentToken!}
              extra={props.extra}
              schemaVersion={props.schemaVersion}
              onSchemaChange={props.onSchemaChange}
              onQueryChange={props.onQueryChange}
              onTabChange={props.onTabChange}
            />
          </StyledCard>
        </ChartRendererStateProvider>
      </RollupDesignerContext>
    </CubeProvider>
  );
}

type QueryTabsRendererProps = {
  apiUrl: string;
  token: string;
  cubejsApi: ReturnType<typeof useCubejsApi>;
} & Pick<
  QueryBuilderProps,
  'schemaVersion' | 'onSchemaChange' | 'onQueryChange' | 'extra'
> &
  Pick<QueryTabsProps, 'onTabChange'>;

function QueryTabsRenderer({
  apiUrl,
  token,
  cubejsApi,
  onQueryChange,
  ...props
}: QueryTabsRendererProps) {
  // useLocation subscribes to RouterContext, so SPA navigation back to
  // /build (after KeepAlive hides + reshows ExplorePage) triggers a
  // re-render — useHistory().location is a non-reactive snapshot and
  // would leave QueryTabsRenderer stale on the new URL.
  const location = useLocation();
  const { setQuery, toggleModal } = useRollupDesignerContext();
  const gameId = useActiveGameId();

  useEffect(() => {
    const handler = () => toggleModal();
    window.addEventListener(OPEN_ROLLUP_DESIGNER_EVENT, handler);
    return () => window.removeEventListener(OPEN_ROLLUP_DESIGNER_EVENT, handler);
  }, [toggleModal]);

  // Build a predicate from the active /meta — a cube exposes `gameId` if it
  // lists a dimension named `<cube>.gameId`. We probe lazily so the call is
  // a noop until /meta has resolved.
  const cubeHasGameDim = useMemo(() => {
    let cache: Set<string> | null = null;
    return (cube: string): boolean => {
      if (!cache) {
        const meta = (cubejsApi as any)?.meta?.cubes ?? null;
        if (!meta) return false;
        cache = new Set<string>();
        for (const c of meta) {
          for (const d of c.dimensions ?? []) {
            if (typeof d?.name === 'string' && d.name.endsWith('.gameId')) {
              cache.add(d.name.split('.')[0]);
            }
          }
        }
      }
      return cache.has(cube);
    };
  }, [cubejsApi]);

  const params = new URLSearchParams(location.search);

  // --------------------------------------------------------------------------
  // ?from-chat-artifact=<id> — consume CubeQuery payload from sessionStorage.
  //
  // On first render with a given artifactId:
  //   - Key present  → parse, clear key, use as query (inline hydration).
  //   - Key missing  → show stale-link toast (user refreshed after key expired).
  // Does NOT affect existing ?query= or ?from-segment= flows.
  // --------------------------------------------------------------------------
  const chatArtifactId = params.get('from-chat-artifact');
  // Ref tracks which artifactId we already processed so we don't re-run on
  // every render while the URL still contains the param.
  const processedArtifactRef = useRef<string | null>(null);
  // Ref holds the parsed payload after the first successful read.
  const chatPayloadRef = useRef<Record<string, unknown> | null>(null);

  if (chatArtifactId && processedArtifactRef.current !== chatArtifactId) {
    // Mark as processed immediately (synchronous, before any render side-effects).
    processedArtifactRef.current = chatArtifactId;
    chatPayloadRef.current = null;

    const storageKey = `gds-cube:pending-chat-deeplink:${chatArtifactId}`;
    const raw = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(storageKey)
      : null;

    if (raw) {
      // Clear before parsing — prevents double-consume on strict-mode double render.
      sessionStorage.removeItem(storageKey);
      try {
        chatPayloadRef.current = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        chatPayloadRef.current = null;
      }
    } else {
      // Key absent: expired or was never written (e.g. user refreshed page).
      // Show warning via antd message (non-blocking).
      message.warning(
        'This chat link has expired — return to the chat to re-open it.',
        4,
      );
    }
  }

  // Resolve final query: chat-artifact payload > ?query= param > null.
  const rawQuery =
    (chatArtifactId && processedArtifactRef.current === chatArtifactId
      ? chatPayloadRef.current
      : null) ??
    JSON.parse(params.get('query') || 'null');

  // Rewrite "last N week/month/quarter/year" relative strings to rolling
  // [start, end] tuples before they reach Cube. Cube's date-parser snaps
  // these to completed calendar units and silently drops the current
  // period — the chat-side normalizer covers freshly-emitted URLs, this
  // one covers already-shared URLs and hand-edited ones.
  const normalizedQuery = normalizeQueryRelativeDateRanges(rawQuery);
  const query = applyGameFilter(normalizedQuery, gameId, cubeHasGameDim);

  return (
    <QueryTabs
      key={gameId}
      gameId={gameId}
      query={query}
      sidebar={null}
      onTabChange={(tab) => {
        props.onTabChange?.(tab);
        setQuery(tab.query);
      }}
    >
      {({ id, query, chartType }, saveTab) => (
        <Panel key={id} height="100% 100%" fill="#clear">
          <QueryBuilder
            apiUrl={apiUrl}
            apiToken={token}
            defaultQuery={applyGameFilter(query, gameId, cubeHasGameDim)}
            defaultChartType={chartType}
            schemaVersion={props.schemaVersion}
            extra={props.extra ?? null}
            RequestStatusComponent={RequestStatusComponent}
            VizardComponent={PlaygroundVizard}
            onSchemaChange={props.onSchemaChange}
            onQueryChange={(data) => {
              saveTab(data);
              onQueryChange?.(data);
            }}
          />
        </Panel>
      )}
    </QueryTabs>
  );
}
