import type { CSSProperties } from 'react';
import Icon, { ThunderboltFilled } from '@ant-design/icons';
import { Alert, Button, Space, Typography } from 'antd';
import styled from 'styled-components';

import { useServerCoreVersionGte } from '../../../hooks';
import { useRollupDesignerContext } from '../../../rollup-designer';
import { QueryStatus } from './PlaygroundQueryBuilder';

const STATUS_PILL_STYLE: CSSProperties = {
  height: 'var(--row-height-tight)',
  padding: '0 var(--row-padding-x-tight)',
  fontSize: 12,
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
};

const Badge = styled.div`
  display: flex;
  align-items: center;
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--warning-bg-color);
`;

type PreAggregationStatusProps = Pick<
  QueryStatus,
  'preAggregationType' | 'isAggregated' | 'external' | 'extDbType'
>;

export function PreAggregationStatus({
  isAggregated,
  external,
  extDbType,
  preAggregationType,
}: PreAggregationStatusProps) {
  const isVersionGte = useServerCoreVersionGte('0.28.4');
  const { toggleModal } = useRollupDesignerContext();

  // `usedPreAggregations` (which drives `isAggregated`) comes back EMPTY for
  // rollup_lambda pre-aggregations using `union_with_source_data` — even when
  // CubeStore actually served the query. Cube still flags those results as served
  // from the external store, so treat `external` as acceleration too; otherwise
  // the badge falsely reports "not accelerated" for every lambda rollup. The
  // migration-suggestion alerts below stay keyed on the real `isAggregated`.
  const accelerated = isAggregated || Boolean(external);

  // hide it for the time being
  // const renderTime = () => (
  //   <Typography.Text strong style={{ color: 'rgba(20, 20, 70, 0.85)' }}>
  //     {formatNumber(timeElapsed)} ms
  //   </Typography.Text>
  // );

  return (
    <>
      <Space style={{ marginLeft: 'auto' }}>
        {accelerated && (
          <Badge>
            <Space size={4}>
              <Icon
                style={{ color: 'var(--warning-color)' }}
                component={() => <ThunderboltFilled />}
              />
            </Space>
          </Badge>
        )}

        {accelerated ? (
          <Typography.Text style={{ fontSize: 12, lineHeight: 1 }}>
            Query was accelerated with pre-aggregation
          </Typography.Text>
        ) : isVersionGte ? (
          <Button
            data-testid="not-pre-agg-query-btn"
            type="link"
            size="small"
            style={STATUS_PILL_STYLE}
            onClick={() => toggleModal()}
          >
            Query was not accelerated with pre-aggregation {'->'}
          </Button>
        ) : null}

        {isAggregated && external && extDbType !== 'cubestore' ? (
          <Alert
            message="Consider migrating your pre-aggregations to Cube Store for better performance with larger datasets"
            type="warning"
          />
        ) : null}

        {isAggregated && !external && preAggregationType !== 'originalSql' ? (
          <Alert
            message={
              <>
                For optimized performance, consider using <b>external</b>{' '}
                {preAggregationType} pre-aggregation, rather than the source
                database (internal)
              </>
            }
            type="warning"
          />
        ) : null}
      </Space>
    </>
  );
}
