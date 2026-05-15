import { useMemo } from 'react';
import styled from 'styled-components';
import { SerializedResult } from '@cubejs-client/core';
import { Alert } from '@cube-dev/ui-kit';

import { useQueryBuilderContext } from '../context';

const InlineBanner = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--preagg-banner-bg);
  border: 1px solid var(--preagg-banner-border);
  color: var(--preagg-banner-text);
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.3;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgba(154, 52, 18, 0.4);
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--preagg-banner-bg-hover);
  }
`;

type Props = {
  /**
   * When true, render as a compact inline chip (no card wrappers) — for use
   * inside the Run card's right slot. Falsy renders the legacy stacked Alerts.
   */
  inline?: boolean;
};

export function PreAggregationAlerts({ inline = false }: Props) {
  const { resultSet } = useQueryBuilderContext();
  const {
    external,
    // dbType,
    extDbType,
    usedPreAggregations = {},
  } = useMemo(() => {
    if (resultSet) {
      const { loadResponse } = resultSet?.serialize();

      return loadResponse.results[0] || {};
    }

    return {} as SerializedResult['loadResponse'];
  }, [resultSet?.rawData()]);

  // @ts-ignore
  const preAggregationType = Object.values(usedPreAggregations || {})[0]?.type;

  const isAggregated = Object.keys(usedPreAggregations).length > 0;

  const showCubeStoreMigration =
    isAggregated && external && extDbType !== 'cubestore';
  const showExternalSuggestion =
    isAggregated && !external && preAggregationType !== 'originalSql';

  if (inline) {
    if (showCubeStoreMigration) {
      return (
        <InlineBanner type="button">
          Consider migrating pre-aggregations to Cube Store →
        </InlineBanner>
      );
    }

    if (showExternalSuggestion) {
      return (
        <InlineBanner type="button">
          Consider using external {preAggregationType} pre-aggregation →
        </InlineBanner>
      );
    }

    return null;
  }

  return (
    <>
      {showCubeStoreMigration ? (
        <Alert theme="note" padding="1x">
          Consider migrating your pre-aggregations to Cube Store for better performance with larger
          datasets
        </Alert>
      ) : null}

      {showExternalSuggestion ? (
        <Alert theme="note" padding="1x">
          For optimized performance, consider using <b>external</b> {preAggregationType}{' '}
          pre-aggregation, rather than the source database (internal)
        </Alert>
      ) : null}
    </>
  );
}
