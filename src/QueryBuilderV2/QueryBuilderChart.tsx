import { useEffect, useMemo, useRef } from 'react';
import { Skeleton } from '@cube-dev/ui-kit';

import { useQueryBuilderContext } from './context';
import { QueryBuilderChartResults } from './QueryBuilderChartResults';

const CHART_HEIGHT = 400;

const ALLOWED_CHART_TYPES = ['table', 'line', 'bar', 'area'];

interface QueryBuilderChartProps {
  maxHeight?: number;
}

export function QueryBuilderChart(_props: QueryBuilderChartProps) {
  let {
    query,
    isLoading,
    chartType,
    pivotConfig,
    resultSet,
  } = useQueryBuilderContext();
  const containerRef = useRef<HTMLDivElement>(null);

  if (!ALLOWED_CHART_TYPES.includes(chartType || '')) {
    chartType = 'line';
  }

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const onScroll = () => {
      if (chartType !== 'table') {
        element.scrollTop = 0;

        setTimeout(() => {
          element.scrollTop = 0;
        });
      }
    };

    element.addEventListener('scroll', onScroll);

    return () => {
      element.removeEventListener('scroll', onScroll);
    };
  }, [containerRef.current]);

  const chart = useMemo(
    () => (
      <QueryBuilderChartResults
        resultSet={resultSet}
        isLoading={isLoading}
        query={query}
        pivotConfig={pivotConfig}
        chartType={chartType}
        isExpanded
        containerRef={containerRef}
      />
    ),
    [resultSet, chartType, isLoading, pivotConfig]
  );

  return (
    <>
      {isLoading ? <Skeleton height={CHART_HEIGHT} layout="chart" padding="0 1x 1x 1x" /> : null}
      {chart}
    </>
  );
}
