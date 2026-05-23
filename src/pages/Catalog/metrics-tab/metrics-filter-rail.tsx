/**
 * MetricsFilterRail — six collapsible facet groups. State is lifted to the
 * MetricsTab; this component is purely presentational.
 */

import styled from 'styled-components';

import { DOMAINS, TRUST_TIERS } from './business-metric-constants';
import type {
  BusinessMetricDomain,
  BusinessMetricTrust,
} from './business-metric-types';
import type { MetricFilters } from './use-filtered-metrics';

const Rail = styled.aside`
  width: 220px;
  padding: 16px 12px;
  border-right: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-card, #ffffff);
  overflow-y: auto;
`;

const Group = styled.section`
  margin-bottom: 18px;
`;

const GroupTitle = styled.h4`
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted, #737373);
`;

const Option = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary, #525252);

  &:hover {
    background: rgba(0, 0, 0, 0.03);
  }
`;

function toggleIn<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

interface MetricsFilterRailProps {
  filters: MetricFilters;
  ownersAvailable: string[];
  tiersAvailable: number[];
  onChange: (next: MetricFilters) => void;
}

export function MetricsFilterRail({
  filters,
  ownersAvailable,
  tiersAvailable,
  onChange,
}: MetricsFilterRailProps) {
  function set<K extends keyof MetricFilters>(key: K, value: MetricFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <Rail aria-label="Metric filters">
      <Group>
        <GroupTitle>Domain</GroupTitle>
        {DOMAINS.map((d) => (
          <Option key={d}>
            <input
              type="checkbox"
              checked={filters.domains.has(d)}
              onChange={() => set('domains', toggleIn(filters.domains, d as BusinessMetricDomain))}
            />
            {d}
          </Option>
        ))}
      </Group>

      <Group>
        <GroupTitle>Trust</GroupTitle>
        {TRUST_TIERS.map((t) => (
          <Option key={t}>
            <input
              type="checkbox"
              checked={filters.trusts.has(t)}
              onChange={() => set('trusts', toggleIn(filters.trusts, t as BusinessMetricTrust))}
            />
            {t}
          </Option>
        ))}
      </Group>

      {tiersAvailable.length > 0 && (
        <Group>
          <GroupTitle>Tier</GroupTitle>
          {tiersAvailable.map((tier) => (
            <Option key={tier}>
              <input
                type="checkbox"
                checked={filters.tiers.has(tier)}
                onChange={() => set('tiers', toggleIn(filters.tiers, tier))}
              />
              Tier {tier}
            </Option>
          ))}
        </Group>
      )}

      {ownersAvailable.length > 0 && (
        <Group>
          <GroupTitle>Owner</GroupTitle>
          {ownersAvailable.map((owner) => (
            <Option key={owner}>
              <input
                type="checkbox"
                checked={filters.owners.has(owner)}
                onChange={() => set('owners', toggleIn(filters.owners, owner))}
              />
              {owner}
            </Option>
          ))}
        </Group>
      )}

      <Group>
        <GroupTitle>Toggles</GroupTitle>
        <Option>
          <input
            type="checkbox"
            checked={filters.parameterisedOnly}
            onChange={() => set('parameterisedOnly', !filters.parameterisedOnly)}
          />
          Parameterised only
        </Option>
        <Option>
          <input
            type="checkbox"
            checked={filters.showDeprecated}
            onChange={() => set('showDeprecated', !filters.showDeprecated)}
          />
          Show deprecated
        </Option>
        <Option>
          <input
            type="checkbox"
            checked={filters.hideUnavailable}
            onChange={() => set('hideUnavailable', !filters.hideUnavailable)}
          />
          Hide unavailable for this game
        </Option>
      </Group>
    </Rail>
  );
}
