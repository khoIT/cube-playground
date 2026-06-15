/**
 * MetricsFilterBar — inline-visible facet rows for the metrics catalog.
 * Every option for every facet renders as a clickable pill so users see at a
 * glance what's filterable. Replaces the prior dropdown-chip iteration that
 * hid options behind a click.
 *
 * File name retained as `metrics-filter-rail.tsx` for git history continuity;
 * the exported `MetricsFilterBar` reflects the current top-bar role.
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
import { TrustBadge } from '../../../shared/concept-shell/trust-badge';
import { DOMAINS, TRUST_TIERS } from './business-metric-constants';
import type {
  BusinessMetricDomain,
  BusinessMetricTrust,
} from './business-metric-types';
import type { MetricFilters } from './use-filtered-metrics';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 16px 10px;
  border-bottom: 1px solid var(--border-card);
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

interface MetricsFilterBarProps {
  filters: MetricFilters;
  onChange: (next: MetricFilters) => void;
}

function countActive(filters: MetricFilters): number {
  // Owner is not surfaced as a facet right now, but its selected set still
  // counts for accurate badge math.
  return (
    filters.domains.size +
    filters.trusts.size +
    filters.owners.size +
    (filters.parameterisedOnly ? 1 : 0) +
    (filters.showDeprecated ? 1 : 0) +
    (filters.hideUnavailable ? 1 : 0)
  );
}

export function MetricsFilterBar({ filters, onChange }: MetricsFilterBarProps) {
  function set<K extends keyof MetricFilters>(key: K, value: MetricFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  const [collapsed, setCollapsed] = React.useState<boolean>(() =>
    getFilterBarCollapsed('metrics-catalog'),
  );
  React.useEffect(
    () => onFilterBarCollapsedChange('metrics-catalog', setCollapsed),
    [],
  );

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    setFilterBarCollapsed('metrics-catalog', next);
  }

  const active = countActive(filters);

  return (
    <Container aria-label="Metric filters">
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
            label="Domain"
            options={[...DOMAINS] as BusinessMetricDomain[]}
            selected={filters.domains}
            onChange={(next) => set('domains', next)}
          />
          <FilterPillRow
            label="Trust"
            options={[...TRUST_TIERS] as BusinessMetricTrust[]}
            selected={filters.trusts}
            onChange={(next) => set('trusts', next)}
            renderOption={(value, active, toggle) => (
              <TrustBadge
                trust={value as BusinessMetricTrust}
                size="sm"
                selected={active}
                onClick={toggle}
              />
            )}
          />
          <TogglesRow>
            <TogglesLabel>Options</TogglesLabel>
            <TogglePill
              label="Parameterised only"
              checked={filters.parameterisedOnly}
              onChange={() => set('parameterisedOnly', !filters.parameterisedOnly)}
            />
            <TogglePill
              label="Show deprecated"
              checked={filters.showDeprecated}
              onChange={() => set('showDeprecated', !filters.showDeprecated)}
            />
            <TogglePill
              label="Hide unavailable for this game"
              checked={filters.hideUnavailable}
              onChange={() => set('hideUnavailable', !filters.hideUnavailable)}
            />
          </TogglesRow>
        </FilterPillStack>
      )}
    </Container>
  );
}
