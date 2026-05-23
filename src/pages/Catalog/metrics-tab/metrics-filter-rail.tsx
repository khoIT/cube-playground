/**
 * MetricsFilterBar — horizontal dropdown-chip top bar for the metrics catalog.
 * Replaces the legacy left rail. Each facet is its own chip with a popover.
 *
 * File name retained as `metrics-filter-rail.tsx` for git history continuity;
 * the exported `MetricsFilterBar` reflects the new top-bar role.
 */

import styled from 'styled-components';

import {
  FilterChipBar,
  MultiSelectChip,
  ToggleGroupChip,
} from '../../../shared/filter-chip-bar/filter-chip-bar';
import { DOMAINS, TRUST_TIERS } from './business-metric-constants';
import type {
  BusinessMetricDomain,
  BusinessMetricTrust,
} from './business-metric-types';
import type { MetricFilters } from './use-filtered-metrics';

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-app, transparent);
`;

interface MetricsFilterBarProps {
  filters: MetricFilters;
  ownersAvailable: string[];
  tiersAvailable: number[];
  onChange: (next: MetricFilters) => void;
}

export function MetricsFilterBar({
  filters,
  ownersAvailable,
  tiersAvailable,
  onChange,
}: MetricsFilterBarProps) {
  function set<K extends keyof MetricFilters>(key: K, value: MetricFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  const tierOptions = tiersAvailable.map((t) => ({ value: t, label: `Tier ${t}` }));

  return (
    <Container aria-label="Metric filters">
      <FilterChipBar>
        <MultiSelectChip
          label="Domain"
          options={[...DOMAINS] as BusinessMetricDomain[]}
          selected={filters.domains}
          onChange={(next) => set('domains', next)}
        />
        <MultiSelectChip
          label="Trust"
          options={[...TRUST_TIERS] as BusinessMetricTrust[]}
          selected={filters.trusts}
          onChange={(next) => set('trusts', next)}
        />
        {tierOptions.length > 0 && (
          <MultiSelectChip<number>
            label="Tier"
            options={tierOptions}
            selected={filters.tiers}
            onChange={(next) => set('tiers', next)}
          />
        )}
        {ownersAvailable.length > 0 && (
          <MultiSelectChip
            label="Owner"
            options={ownersAvailable}
            selected={filters.owners}
            onChange={(next) => set('owners', next)}
          />
        )}
        <ToggleGroupChip
          label="Options"
          toggles={[
            {
              key: 'parameterisedOnly',
              label: 'Parameterised only',
              checked: filters.parameterisedOnly,
              onChange: () => set('parameterisedOnly', !filters.parameterisedOnly),
            },
            {
              key: 'showDeprecated',
              label: 'Show deprecated',
              checked: filters.showDeprecated,
              onChange: () => set('showDeprecated', !filters.showDeprecated),
            },
            {
              key: 'hideUnavailable',
              label: 'Hide unavailable for this game',
              checked: filters.hideUnavailable,
              onChange: () => set('hideUnavailable', !filters.hideUnavailable),
            },
          ]}
        />
      </FilterChipBar>
    </Container>
  );
}
