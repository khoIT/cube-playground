/**
 * MetricListRow — compact one-line layout used when the user picks list view
 * via the search-row toggle. Same data as `MetricCard` but denser: id,
 * description, owner/tier badges, anomaly hint, "x of y available" status.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { SelectionCheckbox } from '../../../shared/catalog-grouped-view/catalog-group-primitives';
import type { BusinessMetric } from './business-metric-types';

const Row = styled(Link)<{ $disabled: boolean }>`
  position: relative;
  display: grid;
  grid-template-columns: 38px minmax(0, 1.4fr) minmax(0, 2fr) 110px 96px;
  align-items: center;
  gap: 12px;
  padding: 10px 16px 10px 38px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 8px;
  background: var(--bg-card, #ffffff);
  text-decoration: none;
  color: inherit;
  opacity: ${(p) => (p.$disabled ? 0.55 : 1)};
  transition: border-color 0.12s ease;

  &:hover {
    border-color: var(--brand, #f05a22);
  }
`;

const Title = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #171717);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Desc = styled.span`
  font-size: 12px;
  color: var(--text-secondary, #525252);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled.span`
  font-size: 11px;
  color: var(--text-muted, #737373);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TrustChip = styled.span<{ $trust: BusinessMetric['trust'] }>`
  display: inline-block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 4px;
  background: ${(p) =>
    p.$trust === 'certified'
      ? 'rgba(34, 197, 94, 0.12)'
      : p.$trust === 'deprecated'
        ? 'rgba(245, 158, 11, 0.12)'
        : 'rgba(115, 115, 115, 0.10)'};
  color: ${(p) =>
    p.$trust === 'certified'
      ? '#0f7a3a'
      : p.$trust === 'deprecated'
        ? '#8a5a05'
        : 'var(--text-muted, #737373)'};
`;

interface MetricListRowProps {
  metric: BusinessMetric;
  disabled: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}

export function MetricListRow({
  metric,
  disabled,
  selected,
  onToggleSelected,
}: MetricListRowProps) {
  return (
    <Row to={`/catalog/metric/${metric.id}`} $disabled={disabled}>
      <SelectionCheckbox
        checked={selected}
        onToggle={() => onToggleSelected(metric.id)}
        ariaLabel={`Select metric ${metric.id}`}
      />
      <Title>{metric.label || metric.id}</Title>
      <Desc>{metric.description}</Desc>
      <Meta>
        Tier {metric.tier} · {metric.owner}
      </Meta>
      <TrustChip $trust={metric.trust}>{metric.trust}</TrustChip>
    </Row>
  );
}
