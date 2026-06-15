/**
 * MetricsTab — Catalog default tab. Renders the registry as a filterable list
 * scoped to the active game's available cubes. Visible items are grouped by
 * domain with collapsible section headers.
 *
 * Grid vs. list rendering is controlled by the shared view-mode store.
 */

import { useMemo, useState } from 'react';
import styled from 'styled-components';

import { useGameContext } from '../../../components/Header/use-game-context';
import {
  GroupHeader,
  toggleSetMember,
} from '../../../shared/catalog-grouped-view/catalog-group-primitives';
import { ChangeAnalysisModal } from '../../../shared/concept-shell/change-analysis-modal';
import { useViewMode } from '../../../shared/view-mode/view-mode-toggle';
import { useCatalogMeta } from '../use-catalog-meta';
import { unprefixedAlias } from '../../../components/workspace-context';
import type { BusinessMetric, BusinessMetricDomain } from './business-metric-types';
import { DOMAINS } from './business-metric-constants';
import { MetricCard } from './metric-card';
import { MetricListRow } from './metric-list-row';
import { MetricsFilterBar } from './metrics-filter-rail';
import { MetricsSearchRow } from './metrics-search-row';
import { DriftSummaryStrip } from './drift-summary-strip';
import { useBusinessMetrics } from './use-business-metrics';
import {
  emptyFilters,
  type MetricFilters,
  type FilteredMetric,
  useFilteredMetrics,
} from './use-filtered-metrics';

const Wrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
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
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const StatusLine = styled.div<{ $kind: 'info' | 'error' }>`
  padding: 14px 16px;
  font-size: 13px;
  color: ${(p) => (p.$kind === 'error' ? 'var(--danger)' : 'var(--text-muted)')};
`;

const Empty = styled.div`
  padding: 40px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

function groupByDomain(items: FilteredMetric[]): Map<BusinessMetricDomain, FilteredMetric[]> {
  const out = new Map<BusinessMetricDomain, FilteredMetric[]>();
  for (const it of items) {
    const arr = out.get(it.metric.domain) ?? [];
    arr.push(it);
    out.set(it.metric.domain, arr);
  }
  return out;
}

export function MetricsTab() {
  const { cubes } = useCatalogMeta();
  const { gameId, games } = useGameContext();
  const { metrics, loading, error } = useBusinessMetrics(gameId);
  const [filters, setFilters] = useState<MetricFilters>(() => emptyFilters());
  const [query, setQuery] = useState('');
  const [anomalyMetric, setAnomalyMetric] = useState<BusinessMetric | null>(null);
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(() => new Set());
  const [viewMode] = useViewMode('metrics-catalog');

  // Prefix workspaces (prod cube-dev) namespace cubes as `<prefix>_<name>`,
  // but the business-metrics registry references unprefixed names. Include
  // both the real and the unprefixed alias so availability matching works
  // for either workspace shape.
  const availableCubeNames = useMemo(() => {
    const out = new Set<string>();
    for (const c of cubes) {
      out.add(c.name);
      const alias = unprefixedAlias(c.name);
      if (alias) out.add(alias);
    }
    return out;
  }, [cubes]);

  const result = useFilteredMetrics(metrics, filters, query, availableCubeNames, gameId ?? undefined);

  const activeGameLabel = games.find((g) => g.id === gameId)?.name ?? gameId;

  const grouped = useMemo(() => groupByDomain(result.visible), [result.visible]);
  // Preserve a stable domain order using the canonical DOMAINS list, then
  // fall back to any unexpected domains alphabetically.
  const orderedDomains = useMemo(() => {
    const present = new Set(grouped.keys());
    const known = (DOMAINS as readonly BusinessMetricDomain[]).filter((d) => present.has(d));
    const extras = Array.from(present).filter((d) => !known.includes(d)).sort();
    return [...known, ...extras];
  }, [grouped]);

  return (
    <Wrap>
      <MetricsSearchRow
        query={query}
        onQueryChange={setQuery}
        visibleCount={result.visible.length}
        availableCount={result.availableCount}
        totalCount={result.totalCount}
        activeGameLabel={activeGameLabel}
      />
      <DriftSummaryStrip
        gameId={gameId}
        gameLabel={activeGameLabel}
        onViewDrafts={() =>
          setFilters((prev) => ({
            ...prev,
            trusts: new Set([...prev.trusts, 'draft' as const]),
          }))
        }
      />
      <MetricsFilterBar filters={filters} onChange={setFilters} />
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
        {!loading && !error && orderedDomains.map((domain) => {
          const items = grouped.get(domain) ?? [];
          const collapsed = collapsedDomains.has(domain);
          return (
            <section key={domain}>
              <GroupHeader
                label={domain}
                count={items.length}
                collapsed={collapsed}
                onToggle={() =>
                  setCollapsedDomains((prev) => toggleSetMember(prev, domain))
                }
              />
              {!collapsed && (
                viewMode === 'grid' ? (
                  <Grid role="list">
                    {items.map(({ metric, available, missingCubes, cold, blockedByApplicability }) => (
                      <MetricCard
                        key={metric.id}
                        metric={metric}
                        disabled={!available}
                        missingCubes={missingCubes}
                        cold={cold}
                        blockedByApplicability={blockedByApplicability}
                        activeGameLabel={activeGameLabel}
                        onAnomalyClick={setAnomalyMetric}
                      />
                    ))}
                  </Grid>
                ) : (
                  <List role="list">
                    {items.map(({ metric, available, cold }) => (
                      <MetricListRow
                        key={metric.id}
                        metric={metric}
                        disabled={!available}
                        cold={cold}
                      />
                    ))}
                  </List>
                )
              )}
            </section>
          );
        })}
      </Main>
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
