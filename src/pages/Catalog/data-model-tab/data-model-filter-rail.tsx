/**
 * DataModelFilterBar — inline-visible facet rows for the data-model catalog
 * (Type / Cube / View / Cross-reference toggles). Collapsible.
 *
 * `DataModelGroupByBar` is a sibling strip that lives outside this container:
 * the Group-by control is rendered as an always-visible row below the filter
 * rail so the active sectioning axis stays discoverable even when filters are
 * collapsed (matches the Hermes Feature Store layout pattern).
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
import {
  GROUP_BY_KEYS,
  GROUP_BY_LABEL,
  type GroupByKey,
} from './group-by-spec';
import type { ConceptFilters } from './use-filtered-concepts';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 16px 10px;
  border-bottom: 1px solid var(--border-card);
  background: var(--bg-card);
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
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--brand);
  }
`;

const Chevron = styled.span<{ $collapsed: boolean }>`
  display: inline-flex;
  transform: rotate(${(p) => (p.$collapsed ? '-90deg' : '0deg')});
  transition: transform 0.15s ease;
`;

const ActiveCount = styled.span`
  color: var(--brand);
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
  color: var(--text-muted);
  margin-right: 4px;
`;

const TYPES: ConceptType[] = ['measure', 'dimension', 'segment'];

interface DataModelFilterBarProps {
  filters: ConceptFilters;
  onChange: (next: ConceptFilters) => void;
  availableCubes: string[];
  availableViews: string[];
}

function countActive(filters: ConceptFilters): number {
  return (
    filters.types.size +
    filters.cubes.size +
    filters.views.size +
    (filters.cdpProjectedOnly ? 1 : 0) +
    (filters.unreferencedOnly ? 1 : 0)
  );
}

// Standalone Group-by strip — rendered outside DataModelFilterBar so it stays
// visible when the filter rail is collapsed. Single-select pills (TogglePill
// supplies the same styling as the multi-select rows above for visual cohesion).
const GroupByContainer = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 16px 10px;
  border-bottom: 1px solid var(--border-card);
  background: var(--bg-card);
`;

interface DataModelGroupByBarProps {
  value: GroupByKey;
  onChange: (next: GroupByKey) => void;
}

export function DataModelGroupByBar({
  value,
  onChange,
}: DataModelGroupByBarProps) {
  return (
    <GroupByContainer aria-label="Group by">
      <TogglesLabel>Group by</TogglesLabel>
      {GROUP_BY_KEYS.map((k) => (
        <TogglePill
          key={k}
          label={GROUP_BY_LABEL[k]}
          checked={value === k}
          onChange={() => onChange(k)}
        />
      ))}
    </GroupByContainer>
  );
}

export function DataModelFilterBar({
  filters,
  onChange,
  availableCubes,
  availableViews,
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
          <FilterPillRow
            label="View"
            options={availableViews}
            selected={filters.views}
            onChange={(next) => onChange({ ...filters, views: next })}
            emptyHint="No views available"
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
