/**
 * DataModelFilterRail — 4 facets: Type, Cube, CDP-projected-only,
 * Unreferenced-only. Mirrors MetricsFilterRail layout but with smaller
 * groups since concept filtering is less rich than business-metric
 * filtering.
 */

import styled from 'styled-components';

import type { ConceptType } from './concept-types';
import type { ConceptFilters } from './use-filtered-concepts';

const Rail = styled.aside`
  width: 220px;
  padding: 16px 12px;
  border-right: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-card, #ffffff);
  overflow-y: auto;
`;

const Group = styled.div`
  margin-bottom: 18px;
`;

const GroupTitle = styled.h4`
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #737373);
`;

const Item = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 12.5px;
  color: var(--text-secondary, #525252);
  cursor: pointer;

  input { cursor: pointer; }
  &:hover { color: var(--text-primary, #171717); }
`;

const TYPES: ConceptType[] = ['measure', 'dimension', 'segment'];

interface DataModelFilterRailProps {
  filters: ConceptFilters;
  onChange: (next: ConceptFilters) => void;
  availableCubes: string[];
}

function togglesetter<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function DataModelFilterRail({
  filters,
  onChange,
  availableCubes,
}: DataModelFilterRailProps) {
  return (
    <Rail>
      <Group>
        <GroupTitle>Type</GroupTitle>
        {TYPES.map((t) => (
          <Item key={t}>
            <input
              type="checkbox"
              checked={filters.types.has(t)}
              onChange={() =>
                onChange({ ...filters, types: togglesetter(filters.types, t) })
              }
            />
            {t}
          </Item>
        ))}
      </Group>
      <Group>
        <GroupTitle>Cube</GroupTitle>
        {availableCubes.map((cube) => (
          <Item key={cube}>
            <input
              type="checkbox"
              checked={filters.cubes.has(cube)}
              onChange={() =>
                onChange({ ...filters, cubes: togglesetter(filters.cubes, cube) })
              }
            />
            {cube}
          </Item>
        ))}
      </Group>
      <Group>
        <GroupTitle>Cross-reference</GroupTitle>
        <Item>
          <input
            type="checkbox"
            checked={filters.cdpProjectedOnly}
            onChange={() =>
              onChange({ ...filters, cdpProjectedOnly: !filters.cdpProjectedOnly })
            }
          />
          CDP-projected only
        </Item>
        <Item>
          <input
            type="checkbox"
            checked={filters.unreferencedOnly}
            onChange={() =>
              onChange({ ...filters, unreferencedOnly: !filters.unreferencedOnly })
            }
          />
          Unreferenced only
        </Item>
      </Group>
    </Rail>
  );
}
