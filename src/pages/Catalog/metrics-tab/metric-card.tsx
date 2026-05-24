/**
 * MetricCard — one entry in the Metrics tab grid. Disabled overlay applies
 * when the metric's required upstream cubes are missing in the active game.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { SelectionCheckbox } from '../../../shared/catalog-grouped-view/catalog-group-primitives';
import { AnomalyBadge } from '../../../shared/concept-shell/anomaly-badge';
import { DomainChip } from '../../../shared/concept-shell/domain-chip';
import { TrustBadge } from '../../../shared/concept-shell/trust-badge';
import { TypeIcon } from '../../../shared/concept-shell/type-icon';
import { useMergedAnomaly } from '../../../shared/concept-shell/use-merged-anomaly';
import type { BusinessMetric } from './business-metric-types';

const Wrap = styled.div<{ $disabled: boolean; $selected: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px 14px 38px;
  border: 1px solid
    ${(p) =>
      p.$selected ? 'var(--brand, #f05a22)' : 'var(--border-card, #e5e5e5)'};
  border-radius: 10px;
  background: ${(p) =>
    p.$selected ? 'rgba(240, 90, 34, 0.04)' : 'var(--bg-card, #ffffff)'};
  text-decoration: none;
  color: inherit;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.$disabled ? 0.55 : 1)};
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;

  &:hover {
    border-color: ${(p) => (p.$disabled ? 'var(--border-card)' : 'var(--brand, #f05a22)')};
    box-shadow: ${(p) =>
      p.$disabled ? 'none' : '0 1px 6px rgba(0,0,0,0.06)'};
  }
`;

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Label = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #171717);
  flex: 1;
`;

const Synonyms = styled.div`
  font-size: 11px;
  color: var(--text-muted, #737373);
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Description = styled.p`
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-secondary, #525252);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const BadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--text-muted, #737373);
`;

const DisabledTip = styled.div`
  font-size: 11px;
  color: #b91c1c;
  font-style: italic;
`;

interface MetricCardProps {
  metric: BusinessMetric;
  disabled?: boolean;
  missingCubes?: string[];
  activeGameLabel?: string;
  onAnomalyClick?: (metric: BusinessMetric) => void;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
}

export function MetricCard({
  metric,
  disabled = false,
  missingCubes = [],
  activeGameLabel,
  onAnomalyClick,
  selected = false,
  onToggleSelected,
}: MetricCardProps) {
  const liveAnomaly = useMergedAnomaly(metric);
  const inner = (
    <>
      {onToggleSelected && (
        <SelectionCheckbox
          checked={selected}
          onToggle={() => onToggleSelected(metric.id)}
          ariaLabel={`Select metric ${metric.id}`}
        />
      )}
      <TopRow>
        <TypeIcon kind="business-metric" />
        <Label>{metric.label}</Label>
        {metric.synonyms && metric.synonyms.length > 0 && (
          <Synonyms>{metric.synonyms.join(', ')}</Synonyms>
        )}
      </TopRow>
      <Description>{metric.description}</Description>
      <BadgeRow>
        <DomainChip domain={metric.domain} />
        <TrustBadge trust={metric.trust} size="sm" />
        <AnomalyBadge anomaly={liveAnomaly} onClick={() => onAnomalyClick?.(metric)} />
      </BadgeRow>
      <Footer>
        <span>{metric.owner}</span>
      </Footer>
      {disabled && (
        <DisabledTip title={`Missing: ${missingCubes.join(', ')}`}>
          Not available{activeGameLabel ? ` for ${activeGameLabel}` : ''}
        </DisabledTip>
      )}
    </>
  );

  if (disabled) {
    return (
      <Wrap
        $disabled
        $selected={selected}
        as="div"
        role="article"
        aria-disabled="true"
        data-metric-id={metric.id}
      >
        {inner}
      </Wrap>
    );
  }
  return (
    <Wrap
      $disabled={false}
      $selected={selected}
      as={Link}
      to={`/catalog/metric/${metric.id}`}
      role="article"
      data-metric-id={metric.id}
    >
      {inner}
    </Wrap>
  );
}
