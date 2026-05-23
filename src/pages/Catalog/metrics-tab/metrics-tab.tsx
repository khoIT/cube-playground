/**
 * MetricsTab — Catalog default tab. Renders the registry as a filterable grid
 * scoped to the active game's available cubes. The "Open in Explore"-style
 * deep links and per-card right-rail are in the MetricDetailPage (P3.5).
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { useGameContext } from '../../../components/Header/use-game-context';
import { ChangeAnalysisModal } from '../../../shared/concept-shell/change-analysis-modal';
import { useCatalogMeta } from '../use-catalog-meta';
import type { BusinessMetric } from './business-metric-types';
import { MetricCard } from './metric-card';
import { MetricsFilterRail } from './metrics-filter-rail';
import { MetricsSearchRow } from './metrics-search-row';
import { useBusinessMetrics } from './use-business-metrics';
import {
  emptyFilters,
  type MetricFilters,
  useFilteredMetrics,
} from './use-filtered-metrics';

const Wrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const Main = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 32px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  padding: 16px 0;
`;

const StatusLine = styled.div<{ $kind: 'info' | 'error' }>`
  padding: 14px 16px;
  font-size: 13px;
  color: ${(p) => (p.$kind === 'error' ? 'var(--danger, #b91c1c)' : 'var(--text-muted, #737373)')};
`;

const Empty = styled.div`
  padding: 40px 0;
  text-align: center;
  color: var(--text-muted, #737373);
  font-size: 13px;
`;

const HeaderBar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px 0;
`;

const NewMetricLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  background: var(--brand, #f05a22);
  color: white;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;

  &:hover {
    background: var(--brand-pressed, #f54a00);
  }
`;

export function MetricsTab() {
  const { metrics, loading, error } = useBusinessMetrics();
  const { cubes } = useCatalogMeta();
  const { gameId, games } = useGameContext();
  const [filters, setFilters] = useState<MetricFilters>(() => emptyFilters());
  const [query, setQuery] = useState('');
  const [anomalyMetric, setAnomalyMetric] = useState<BusinessMetric | null>(null);

  const availableCubeNames = useMemo(
    () => new Set(cubes.map((c) => c.name)),
    [cubes],
  );

  const result = useFilteredMetrics(metrics, filters, query, availableCubeNames);

  const ownersAvailable = useMemo(
    () => Array.from(new Set(metrics.map((m) => m.owner))).sort(),
    [metrics],
  );
  const tiersAvailable = useMemo(
    () => Array.from(new Set(metrics.map((m) => m.tier))).sort((a, b) => a - b),
    [metrics],
  );

  const activeGameLabel = games.find((g) => g.id === gameId)?.name ?? gameId;

  return (
    <Wrap>
      <HeaderBar>
        <span />
        <NewMetricLink to="/catalog/metric/new">+ New metric</NewMetricLink>
      </HeaderBar>
      <MetricsSearchRow
        query={query}
        onQueryChange={setQuery}
        visibleCount={result.visible.length}
        availableCount={result.availableCount}
        totalCount={result.totalCount}
        activeGameLabel={activeGameLabel}
      />
      <Body>
        <MetricsFilterRail
          filters={filters}
          ownersAvailable={ownersAvailable}
          tiersAvailable={tiersAvailable}
          onChange={setFilters}
        />
        <Main>
          {error && <StatusLine $kind="error">Failed to load metrics: {error}</StatusLine>}
          {loading && <StatusLine $kind="info">Loading metrics…</StatusLine>}
          {!loading && !error && result.visible.length === 0 && (
            <Empty>
              No metrics match the current filters.
              {result.hiddenByGame > 0 && (
                <> {result.hiddenByGame} hidden by "Hide unavailable" for {activeGameLabel}.</>
              )}
            </Empty>
          )}
          {!loading && !error && result.visible.length > 0 && (
            <Grid role="list">
              {result.visible.map(({ metric, available, missingCubes }) => (
                <MetricCard
                  key={metric.id}
                  metric={metric}
                  disabled={!available}
                  missingCubes={missingCubes}
                  activeGameLabel={activeGameLabel}
                  onAnomalyClick={setAnomalyMetric}
                />
              ))}
            </Grid>
          )}
        </Main>
      </Body>
      {anomalyMetric && (
        <ChangeAnalysisModal
          open
          metric={anomalyMetric}
          onClose={() => setAnomalyMetric(null)}
        />
      )}
    </Wrap>
  );
}
