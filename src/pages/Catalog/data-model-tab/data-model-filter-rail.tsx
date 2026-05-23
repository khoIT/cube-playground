/**
 * DataModelFilterBar — horizontal dropdown-chip top bar for the data-model
 * catalog. Replaces the legacy left rail. File name retained for git history
 * continuity; the exported component reflects the new top-bar role.
 */

import styled from 'styled-components';

import {
  FilterChipBar,
  MultiSelectChip,
  ToggleGroupChip,
} from '../../../shared/filter-chip-bar/filter-chip-bar';
import type { ConceptType } from './concept-types';
import type { ConceptFilters } from './use-filtered-concepts';

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-app, transparent);
`;

const TYPES: ConceptType[] = ['measure', 'dimension', 'segment'];

interface DataModelFilterBarProps {
  filters: ConceptFilters;
  onChange: (next: ConceptFilters) => void;
  availableCubes: string[];
}

function toggleIn<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function DataModelFilterBar({
  filters,
  onChange,
  availableCubes,
}: DataModelFilterBarProps) {
  return (
    <Container aria-label="Data model filters">
      <FilterChipBar>
        <MultiSelectChip
          label="Type"
          options={TYPES}
          selected={filters.types}
          onChange={(next) => onChange({ ...filters, types: next })}
        />
        <MultiSelectChip
          label="Cube"
          options={availableCubes}
          selected={filters.cubes}
          onChange={(next) => onChange({ ...filters, cubes: next })}
          emptyHint="No cubes available"
        />
        <ToggleGroupChip
          label="Cross-reference"
          toggles={[
            {
              key: 'cdpProjectedOnly',
              label: 'CDP-projected only',
              checked: filters.cdpProjectedOnly,
              onChange: () =>
                onChange({ ...filters, cdpProjectedOnly: !filters.cdpProjectedOnly }),
            },
            {
              key: 'unreferencedOnly',
              label: 'Unreferenced only',
              checked: filters.unreferencedOnly,
              onChange: () =>
                onChange({ ...filters, unreferencedOnly: !filters.unreferencedOnly }),
            },
          ]}
        />
      </FilterChipBar>
    </Container>
  );
}

// Re-exported helper kept for any external callers that built their own
// togglers around the previous facet primitive.
export { toggleIn };
