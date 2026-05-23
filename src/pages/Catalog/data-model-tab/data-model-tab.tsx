/**
 * DataModelTab — author surface. Concept-first list of measures /
 * dimensions / segments derived from the active game's Cube /meta, grouped
 * by type with collapsible section headers. Each card / row can be selected
 * for bulk-action affordance (no bulk action wired yet — just selection state).
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
import type { Concept, ConceptType } from './concept-types';
import { DataModelFilterBar } from './data-model-filter-rail';
import { DataModelSearchRow } from './data-model-search-row';
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
  color: var(--text-muted, #737373);
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
  color: var(--text-muted, #737373);
  font-size: 13px;
`;

const TYPE_ORDER: ConceptType[] = ['measure', 'dimension', 'segment'];
const TYPE_LABEL: Record<ConceptType, string> = {
  measure: 'measures',
  dimension: 'dimensions',
  segment: 'segments',
};

function groupByType(items: Concept[]): Map<ConceptType, Concept[]> {
  const out = new Map<ConceptType, Concept[]>();
  for (const c of items) {
    const arr = out.get(c.type) ?? [];
    arr.push(c);
    out.set(c.type, arr);
  }
  return out;
}

export function DataModelTab() {
  const { concepts, cubes, loading, error } = useConcepts();
  const { metrics: businessMetrics } = useBusinessMetrics();
  const [filters, setFilters] = useState(() => emptyConceptFilters());
  const [query, setQuery] = useState('');
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [viewMode] = useViewMode('data-model');

  const availableCubes = useMemo(
    () => cubes.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
    [cubes],
  );

  const { visible, totalCount, usageMap } = useFilteredConcepts(
    concepts,
    filters,
    query,
    businessMetrics,
  );

  const grouped = useMemo(() => groupByType(visible), [visible]);
  const orderedTypes = useMemo(() => {
    const present = new Set(grouped.keys());
    return TYPE_ORDER.filter((t) => present.has(t));
  }, [grouped]);

  if (loading) return <Status>Loading data model…</Status>;
  if (error) return <Status>Failed to load /meta: {error}</Status>;

  function toggleSelected(id: string) {
    setSelected((prev) => toggleSetMember(prev, id));
  }

  function selectAllInType(type: ConceptType, allSelected: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const items = grouped.get(type) ?? [];
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
      />
      <Main>
        {selected.size > 0 && (
          <SelectionBanner count={selected.size} onClear={() => setSelected(new Set())} />
        )}
        {visible.length === 0 && <Empty>No concepts match the current filters.</Empty>}
        {orderedTypes.map((type) => {
          const items = grouped.get(type) ?? [];
          const collapsed = collapsedTypes.has(type);
          const selectedInGroup = items.reduce(
            (n, c) => n + (selected.has(`${c.type}:${c.fqn}`) ? 1 : 0),
            0,
          );
          const allSelected = items.length > 0 && selectedInGroup === items.length;
          return (
            <section key={type}>
              <GroupHeader
                label={TYPE_LABEL[type]}
                count={items.length}
                collapsed={collapsed}
                onToggle={() =>
                  setCollapsedTypes((prev) => toggleSetMember(prev, type))
                }
                selectedInGroup={selectedInGroup}
                allSelectedInGroup={allSelected}
                onSelectAll={(all) => selectAllInType(type, all)}
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
