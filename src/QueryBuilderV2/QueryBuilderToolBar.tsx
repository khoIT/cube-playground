import { useMemo } from 'react';
import { Play } from 'lucide-react';
import { SerializedResult } from '@cubejs-client/core';
import { Button, Flex, Space, tasty } from '@cube-dev/ui-kit';

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

export function QueryBuilderToolBar() {
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

      return loadResponse.results[0] || {};
    }

    return {} as SerializedResult['loadResponse'];
  }, [resultSet]);

  // @ts-ignore
  const preAggregationType = Object.values(usedPreAggregations || {})[0]?.type;

  const isAggregated = Object.keys(usedPreAggregations).length > 0;

  return (
    <Flex flow="column" padding="1x" gap="1x">
      <Space height="min-content" placeContent="space-between">
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
        ) : undefined}
      </Space>
      <PreAggregationAlerts />
      <QueryBuilderError />
    </Flex>
  );
}
