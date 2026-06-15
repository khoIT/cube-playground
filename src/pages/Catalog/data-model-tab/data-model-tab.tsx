/**
 * DataModelTab — author surface. Concept-first list of measures /
 * dimensions / segments derived from the active game's Cube /meta. Sections
 * are determined by the user's Group-by axis (default: Type) via
 * `group-by-spec`. Each card / row can be selected for bulk-action
 * affordance (no bulk action wired yet — just selection state).
 *
 * Grid vs. list rendering is controlled by the shared view-mode store.
 */

import { useMemo, useState } from 'react';
import styled from 'styled-components';

import {
  GroupHeader,
  SelectionBanner,
  toggleSetMember,
} from '../../../shared/catalog-grouped-view/catalog-group-primitives';
import { useViewMode } from '../../../shared/view-mode/view-mode-toggle';
import { useBusinessMetrics } from '../metrics-tab/use-business-metrics';
import { ConceptCard } from './concept-card';
import { ConceptListRow } from './concept-list-row';
import type { Concept } from './concept-types';
import {
  DataModelFilterBar,
  DataModelGroupByBar,
} from './data-model-filter-rail';
import { DataModelSearchRow } from './data-model-search-row';
import { groupConcepts } from './group-by-spec';
import { useConcepts } from './use-concepts';
import {
  emptyConceptFilters,
  useFilteredConcepts,
} from './use-filtered-concepts';

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
`;

const Status = styled.div`
  padding: 60px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

const Main = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 24px;
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

const Empty = styled.div`
  padding: 40px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

export function DataModelTab() {
  const { concepts, cubes, loading, error } = useConcepts();
  const { metrics: businessMetrics } = useBusinessMetrics();
  const [filters, setFilters] = useState(() => emptyConceptFilters());
  const [query, setQuery] = useState('');
  // Group collapse keyed by the active group-by axis' bucket key (e.g.
  // 'measure', 'orders', 'heavy', …). Persists across axis changes — if the
  // user re-picks the same key under a different axis the collapse sticks,
  // which is a quirk we accept rather than store per-axis state.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [viewMode] = useViewMode('data-model');

  const { availableCubes, availableViews } = useMemo(() => {
    const cubesOnly: string[] = [];
    const viewsOnly: string[] = [];
    for (const c of cubes) {
      (c.type === 'view' ? viewsOnly : cubesOnly).push(c.name);
    }
    cubesOnly.sort((a, b) => a.localeCompare(b));
    viewsOnly.sort((a, b) => a.localeCompare(b));
    return { availableCubes: cubesOnly, availableViews: viewsOnly };
  }, [cubes]);

  const { visible, totalCount, usageMap } = useFilteredConcepts(
    concepts,
    filters,
    query,
    businessMetrics,
  );

  const groups = useMemo(
    () => groupConcepts(visible, filters.groupBy, usageMap),
    [visible, filters.groupBy, usageMap],
  );

  if (loading) return <Status>Loading data model…</Status>;
  if (error) return <Status>Failed to load /meta: {error}</Status>;

  function toggleSelected(id: string) {
    setSelected((prev) => toggleSetMember(prev, id));
  }

  function selectAllInGroup(items: Concept[], allSelected: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of items) {
        const id = `${c.type}:${c.fqn}`;
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  return (
    <Layout>
      <DataModelSearchRow
        query={query}
        onQueryChange={setQuery}
        visibleCount={visible.length}
        totalCount={totalCount}
      />
      <DataModelFilterBar
        filters={filters}
        onChange={setFilters}
        availableCubes={availableCubes}
        availableViews={availableViews}
      />
      <DataModelGroupByBar
        value={filters.groupBy}
        onChange={(next) => setFilters({ ...filters, groupBy: next })}
      />
      <Main>
        {selected.size > 0 && (
          <SelectionBanner count={selected.size} onClear={() => setSelected(new Set())} />
        )}
        {visible.length === 0 && <Empty>No concepts match the current filters.</Empty>}
        {groups.map((group) => {
          const { key, label, items } = group;
          const collapsed = collapsedGroups.has(key);
          const selectedInGroup = items.reduce(
            (n, c) => n + (selected.has(`${c.type}:${c.fqn}`) ? 1 : 0),
            0,
          );
          const allSelected = items.length > 0 && selectedInGroup === items.length;
          return (
            <section key={key}>
              <GroupHeader
                label={label}
                count={items.length}
                collapsed={collapsed}
                onToggle={() =>
                  setCollapsedGroups((prev) => toggleSetMember(prev, key))
                }
                selectedInGroup={selectedInGroup}
                allSelectedInGroup={allSelected}
                onSelectAll={(all) => selectAllInGroup(items, all)}
              />
              {!collapsed && (
                viewMode === 'grid' ? (
                  <Grid role="list">
                    {items.map((c) => {
                      const id = `${c.type}:${c.fqn}`;
                      return (
                        <ConceptCard
                          key={id}
                          concept={c}
                          usedByCount={usageMap.get(c.fqn) ?? 0}
                          selected={selected.has(id)}
                          onToggleSelected={toggleSelected}
                        />
                      );
                    })}
                  </Grid>
                ) : (
                  <List role="list">
                    {items.map((c) => {
                      const id = `${c.type}:${c.fqn}`;
                      return (
                        <ConceptListRow
                          key={id}
                          concept={c}
                          usedByCount={usageMap.get(c.fqn) ?? 0}
                          selected={selected.has(id)}
                          onToggleSelected={toggleSelected}
                        />
                      );
                    })}
                  </List>
                )
              )}
            </section>
          );
        })}
      </Main>
    </Layout>
  );
}
