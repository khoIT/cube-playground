/**
 * DataModelTab — author surface. Concept-first grid of measures /
 * dimensions / segments derived from the active game's Cube /meta, with
 * filter rail + free-text search + "Used by N metrics" cross-reference
 * against the business-metrics registry.
 */

import { useMemo, useState } from 'react';
import styled from 'styled-components';

import { useBusinessMetrics } from '../metrics-tab/use-business-metrics';
import { DataModelFilterRail } from './data-model-filter-rail';
import { DataModelGrid } from './data-model-grid';
import { DataModelSearchRow } from './data-model-search-row';
import { useConcepts } from './use-concepts';
import {
  emptyConceptFilters,
  useFilteredConcepts,
} from './use-filtered-concepts';

const Layout = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const Status = styled.div`
  padding: 60px 24px;
  text-align: center;
  color: var(--text-muted, #737373);
  font-size: 13px;
`;

export function DataModelTab() {
  const { concepts, cubes, loading, error } = useConcepts();
  const { metrics: businessMetrics } = useBusinessMetrics();
  const [filters, setFilters] = useState(() => emptyConceptFilters());
  const [query, setQuery] = useState('');

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

  if (loading) return <Status>Loading data model…</Status>;
  if (error) return <Status>Failed to load /meta: {error}</Status>;

  return (
    <Layout>
      <DataModelFilterRail
        filters={filters}
        onChange={setFilters}
        availableCubes={availableCubes}
      />
      <Body>
        <DataModelSearchRow
          query={query}
          onQueryChange={setQuery}
          visibleCount={visible.length}
          totalCount={totalCount}
        />
        <DataModelGrid concepts={visible} usageMap={usageMap} />
      </Body>
    </Layout>
  );
}
