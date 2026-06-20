import { useEffect, useMemo, useRef } from 'react';
import { Skeleton } from '@cube-dev/ui-kit';
import type { ResultSet } from '@cubejs-client/core';

import { useQueryBuilderContext } from './context';
import { QueryBuilderChartResults } from './QueryBuilderChartResults';
import { useActiveGameId } from '../components/Header/use-game-context';
import { useOverlayQuery } from './overlay-query-context';
import { useOverlayRows } from './use-overlay-rows';
import { buildDualAxisArtifact } from '../charts/build-dual-axis-artifact';
import type { CubeRow } from '../charts/merge-on-date-value';
import { AssistantChartSection } from '../pages/Chat/components/assistant-chart-section';

const CHART_HEIGHT = 400;

const ALLOWED_CHART_TYPES = ['table', 'line', 'bar', 'area'];

interface QueryBuilderChartProps {
  maxHeight?: number;
}

/** Pull raw rows out of a Cube ResultSet (SDK doesn't type loadResponse). */
function rowsOf(resultSet: ResultSet<any> | null): CubeRow[] {
  if (!resultSet) return [];
  try {
    // @ts-expect-error — SDK types don't expose loadResponse directly
    return (resultSet.loadResponse?.results?.[0]?.data ?? []) as CubeRow[];
  } catch {
    return [];
  }
}

export function QueryBuilderChart(_props: QueryBuilderChartProps) {
  let {
    query,
    isLoading,
    chartType,
    pivotConfig,
    resultSet,
    apiToken,
    apiUrl,
  } = useQueryBuilderContext();
  const containerRef = useRef<HTMLDivElement>(null);

  if (!ALLOWED_CHART_TYPES.includes(chartType || '')) {
    chartType = 'line';
  }

  // Combined-artifact overlay: a second query overlaid on the date axis. Loaded
  // independently (the two cubes share no join) and merged on the date value.
  // Null on every normal builder session — the center renders exactly as before.
  const overlayQuery = useOverlayQuery();
  const activeGameId = useActiveGameId();
  const overlay = useOverlayRows(overlayQuery, apiUrl ?? null, apiToken ?? null, activeGameId ?? null);

  // Build the dual-axis artifact only when both series are ready. A failed/empty
  // overlay degrades to the normal single-series chart (overlayArtifact = null).
  const overlayArtifact = useMemo(() => {
    if (!overlayQuery || !resultSet || isLoading || !overlay.rows) return null;
    return buildDualAxisArtifact({
      primaryQuery: query,
      primaryRows: rowsOf(resultSet),
      overlayQuery,
      overlayRows: overlay.rows,
    });
  }, [overlayQuery, resultSet, isLoading, overlay.rows, query]);

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
    () =>
      overlayArtifact ? (
        // Reuse the shared chat/ops renderer (ResultSet-free, embedded = no
        // header/menu) so the builder center shows the same dual-axis as the
        // chat card the deeplink came from.
        <AssistantChartSection artifact={overlayArtifact} embedded defaultView="chart" />
      ) : (
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
    [overlayArtifact, resultSet, chartType, isLoading, pivotConfig]
  );

  return (
    <>
      {isLoading ? <Skeleton height={CHART_HEIGHT} layout="chart" padding="0 1x 1x 1x" /> : null}
      {chart}
    </>
  );
}
