/**
 * DataModelFilterBar — inline-visible facet rows for the data-model catalog.
 * Every option (Type / Cube / boolean toggle) renders as a pill so users see
 * at a glance what's filterable.
 *
 * File name retained for git history continuity; exported component reflects
 * the current top-bar role.
 */

import React from 'react';
import styled from 'styled-components';
import { ChevronDown } from 'lucide-react';

import {
  FilterPillRow,
  FilterPillStack,
  TogglePill,
} from '../../../shared/filter-chip-bar/filter-chip-bar';
import {
  getFilterBarCollapsed,
  onFilterBarCollapsedChange,
  setFilterBarCollapsed,
} from '../../../shared/filter-chip-bar/filter-bar-collapsed-store';
import type { ConceptType } from './concept-types';
import type { ConceptFilters } from './use-filtered-concepts';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 16px 10px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-app, transparent);
`;

const HeaderRow = styled.button`
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  margin: 0;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted, #737373);
  cursor: pointer;

  &:hover {
    color: var(--brand, #f05a22);
  }
`;

const Chevron = styled.span<{ $collapsed: boolean }>`
  display: inline-flex;
  transform: rotate(${(p) => (p.$collapsed ? '-90deg' : '0deg')});
  transition: transform 0.15s ease;
`;

const ActiveCount = styled.span`
  color: var(--brand, #f05a22);
  font-weight: 600;
`;

const TogglesRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
`;

const TogglesLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted, #737373);
  margin-right: 4px;
`;

const TYPES: ConceptType[] = ['measure', 'dimension', 'segment'];

interface DataModelFilterBarProps {
  filters: ConceptFilters;
  onChange: (next: ConceptFilters) => void;
  availableCubes: string[];
}

function countActive(filters: ConceptFilters): number {
  return (
    filters.types.size +
    filters.cubes.size +
    (filters.cdpProjectedOnly ? 1 : 0) +
    (filters.unreferencedOnly ? 1 : 0)
  );
}

export function DataModelFilterBar({
  filters,
  onChange,
  availableCubes,
}: DataModelFilterBarProps) {
  const [collapsed, setCollapsed] = React.useState<boolean>(() =>
    getFilterBarCollapsed('data-model'),
  );
  React.useEffect(() => onFilterBarCollapsedChange('data-model', setCollapsed), []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    setFilterBarCollapsed('data-model', next);
  }

  const active = countActive(filters);

  return (
    <Container aria-label="Data model filters">
      <HeaderRow
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
      >
        <Chevron $collapsed={collapsed}>
          <ChevronDown size={12} />
        </Chevron>
        Filters
        {active > 0 && <ActiveCount>· {active} active</ActiveCount>}
      </HeaderRow>
      {!collapsed && (
        <FilterPillStack>
          <FilterPillRow
            label="Type"
            options={TYPES}
            selected={filters.types}
            onChange={(next) => onChange({ ...filters, types: next })}
          />
          <FilterPillRow
            label="Cube"
            options={availableCubes}
            selected={filters.cubes}
            onChange={(next) => onChange({ ...filters, cubes: next })}
            emptyHint="No cubes available"
          />
          <TogglesRow>
            <TogglesLabel>Cross-reference</TogglesLabel>
            <TogglePill
              label="CDP-projected only"
              checked={filters.cdpProjectedOnly}
              onChange={() =>
                onChange({ ...filters, cdpProjectedOnly: !filters.cdpProjectedOnly })
              }
            />
            <TogglePill
              label="Unreferenced only"
              checked={filters.unreferencedOnly}
              onChange={() =>
                onChange({ ...filters, unreferencedOnly: !filters.unreferencedOnly })
              }
            />
          </TogglesRow>
        </FilterPillStack>
      )}
    </Container>
  );
}
