import { Panel, Space } from '@cube-dev/ui-kit';
import { CubeProvider } from '@cubejs-client/react';
import { Card } from 'antd';
import { useEffect, useLayoutEffect, useMemo } from 'react';
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
  const rawQuery = JSON.parse(params.get('query') || 'null');
  const query = applyGameFilter(rawQuery, gameId, cubeHasGameDim);

  return (
    <QueryTabs
      key={gameId}
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
