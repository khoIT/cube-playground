/**
 * MetricDetailHeader — title row + badge strip + back-to-catalog breadcrumb.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { AnomalyBadge } from '../../../shared/concept-shell/anomaly-badge';
import { useMergedAnomaly } from '../../../shared/concept-shell/use-merged-anomaly';
import { DomainChip } from '../../../shared/concept-shell/domain-chip';
import { TierBadge } from '../../../shared/concept-shell/tier-badge';
import { TrustBadge } from '../../../shared/concept-shell/trust-badge';
import { TypeIcon } from '../../../shared/concept-shell/type-icon';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';

const Header = styled.header`
  padding: 16px 24px 12px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-app, transparent);
`;

const Breadcrumb = styled.div`
  font-size: 12px;
  color: var(--text-muted, #737373);
  margin-bottom: 8px;

  a {
    color: var(--brand, #f05a22);
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary, #171717);
`;

const Synonyms = styled.span`
  font-size: 12px;
  color: var(--text-muted, #737373);
  font-family: var(--font-mono, monospace);
`;

const BadgeRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 10px;
  align-items: center;
`;

const Description = styled.p`
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #525252);
  max-width: 720px;
`;

interface MetricDetailHeaderProps {
  metric: BusinessMetric;
  onAnomalyClick?: () => void;
}

export function MetricDetailHeader({ metric, onAnomalyClick }: MetricDetailHeaderProps) {
  const liveAnomaly = useMergedAnomaly(metric);
  return (
    <Header>
      <Breadcrumb>
        <Link to="/catalog">Catalog</Link> · Metrics ·{' '}
        <code>{metric.id}</code>
      </Breadcrumb>
      <TitleRow>
        <TypeIcon kind="business-metric" />
        <TierBadge tier={metric.tier} />
        <Title>{metric.label}</Title>
        {metric.synonyms && metric.synonyms.length > 0 && (
          <Synonyms>{metric.synonyms.join(', ')}</Synonyms>
        )}
      </TitleRow>
      <Description>{metric.description}</Description>
      <BadgeRow>
        <DomainChip domain={metric.domain} />
        <TrustBadge trust={metric.trust} />
        <AnomalyBadge anomaly={liveAnomaly} onClick={onAnomalyClick} />
      </BadgeRow>
    </Header>
  );
}
