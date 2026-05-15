import { useMemo } from 'react';
import styled from 'styled-components';
import { Play } from 'lucide-react';
import { SerializedResult } from '@cubejs-client/core';
import { Button, Space, tasty } from '@cube-dev/ui-kit';

import { Card } from '../components/AppPanes';
import { QueryBuilderError } from './QueryBuilderError';
import { useQueryBuilderContext } from './context';
import { PreAggregationAlerts } from './components/PreAggregationAlerts';

const StopIcon = tasty({
  styles: {
    position: 'relative',
    width: '16px',
    height: '16px',

    '&::before': {
      content: '""',
      display: 'block',
      position: 'absolute',
      top: '2px',
      left: '2px',
      width: '12px',
      height: '12px',
      fill: '#danger',
    },
  },
});

const RunBandInner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  flex-wrap: wrap;
`;

const RunBandRight = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
`;

const AlertsStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--pane-gap);
`;

export function QueryBuilderRunControl() {
  const {
    isLoading,
    error,
    resultSet,
    query,
    runQuery,
    stopQuery,
    RequestStatusComponent,
  } = useQueryBuilderContext();

  const hasMembers =
    (query.dimensions?.length ?? 0) +
      (query.measures?.length ?? 0) +
      (query.timeDimensions?.length ?? 0) >
    0;

  const {
    requestId,
    external,
    dbType,
    extDbType,
    usedPreAggregations = {},
  } = useMemo(() => {
    if (resultSet) {
      const { loadResponse } = resultSet?.serialize();

      return loadResponse.results[0] || ({} as any);
    }

    return {} as SerializedResult['loadResponse'] & {
      requestId?: string;
      external?: boolean;
      dbType?: string;
      extDbType?: string;
      usedPreAggregations?: Record<string, unknown>;
    };
  }, [resultSet]);

  // @ts-ignore
  const preAggregationType = Object.values(usedPreAggregations || {})[0]?.type;
  const isAggregated = Object.keys(usedPreAggregations).length > 0;

  return (
    <Card>
      <RunBandInner>
        <Space gap="1x">
          <Button
            qa="RunQueryButton"
            type="primary"
            size="small"
            icon={<Play size={13} strokeWidth={2.5} />}
            isDisabled={isLoading || !hasMembers}
            isLoading={isLoading}
            onPress={() => runQuery()}
          >
            Run query
          </Button>
          {isLoading ? (
            <Button
              qa="StopQueryButton"
              theme="danger"
              size="small"
              icon={<StopIcon />}
              onPress={stopQuery}
            >
              Stop
            </Button>
          ) : null}
        </Space>
        <RunBandRight>
          <PreAggregationAlerts inline />
          {requestId && RequestStatusComponent ? (
            <RequestStatusComponent
              requestId={requestId}
              isAggregated={isAggregated}
              preAggregationType={preAggregationType}
              external={external}
              dbType={dbType}
              extDbType={extDbType}
              error={error ?? undefined}
            />
          ) : null}
        </RunBandRight>
      </RunBandInner>
    </Card>
  );
}

export function QueryBuilderToolBarAlerts() {
  return (
    <AlertsStack>
      <QueryBuilderError />
    </AlertsStack>
  );
}

// Back-compat default export so any stale references still work
export function QueryBuilderToolBar() {
  return (
    <>
      <QueryBuilderRunControl />
      <QueryBuilderToolBarAlerts />
    </>
  );
}
