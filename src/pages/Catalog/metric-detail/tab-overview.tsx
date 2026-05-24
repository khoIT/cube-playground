/**
 * TabOverview — top-of-page hero for a business metric.
 *
 * Layout:
 *   - Full-width sparkline card (last 30 days, leading measure) — replaces
 *     the previous "coming in Phase 8" placeholder.
 *   - Full-width runnability banner directly under the sparkline so the
 *     yellow warning (with missing refs) renders at the full content width
 *     instead of cramped inside the 240px right rail.
 *   - Two-column body: description + sidebar facts (Domain / Owner / Trust /
 *     Unit / Format).
 *
 * The right rail still hosts the action buttons but no longer carries the
 * warning strip itself.
 */
import styled from 'styled-components';

import { MetricRunnabilityWarning } from '../../../shared/concept-shell/metric-runnability-warning';
import { useMetricOverrideStore } from '../metrics-tab/metric-override-store';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import { useCatalogMeta } from '../use-catalog-meta';
import { MetricSparkline } from './metric-sparkline';
import { useMetricRunnability } from './use-metric-runnability';
import { useMetricSparkline } from './use-metric-sparkline';

const Wrap = styled.section`
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const TopRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 24px;
  align-items: start;
`;

const Body = styled.div`
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary, #525252);
`;

const Side = styled.aside`
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--bg-card, #ffffff);
  font-size: 12px;
`;

const SideTitle = styled.h4`
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #737373);
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid var(--border-card, #f0f0f0);

  &:first-of-type { border-top: 0; }
`;

const Label = styled.span`
  color: var(--text-muted, #737373);
`;

const Value = styled.span`
  color: var(--text-primary, #171717);
  font-weight: 500;
  text-align: right;
  word-break: break-word;
`;

const AkaLabel = styled.span`
  color: var(--text-muted, #737373);
`;

const Aka = styled.code`
  font-size: 12px;
  background: rgba(0, 0, 0, 0.04);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--text-secondary, #525252);
`;

export function TabOverview({ metric }: { metric: BusinessMetric }) {
  const { cubes } = useCatalogMeta();
  const runnability = useMetricRunnability(metric);
  const overridden = useMetricOverrideStore((s) => s.allowed.has(metric.id));
  const sparklineDisabled = runnability.status === 'broken' && !overridden;
  const sparkline = useMetricSparkline({ metric, cubes, disabled: sparklineDisabled });

  return (
    <Wrap>
      <MetricSparkline metric={metric} result={sparkline} disabled={sparklineDisabled} />
      <MetricRunnabilityWarning metricId={metric.id} runnability={runnability} />
      <TopRow>
        <Body>
          <p>{metric.description}</p>
          {metric.synonyms && metric.synonyms.length > 0 && (
            <p>
              <AkaLabel>Also known as: </AkaLabel>
              <Aka>{metric.synonyms.join(', ')}</Aka>
            </p>
          )}
        </Body>
        <Side>
          <SideTitle>About this metric</SideTitle>
          <Row>
            <Label>Domain</Label>
            <Value>{metric.domain}</Value>
          </Row>
          <Row>
            <Label>Owner</Label>
            <Value>{metric.owner}</Value>
          </Row>
          <Row>
            <Label>Trust</Label>
            <Value>{metric.trust}</Value>
          </Row>
          <Row>
            <Label>Tier</Label>
            <Value>{metric.tier}</Value>
          </Row>
          {metric.unit && (
            <Row>
              <Label>Unit</Label>
              <Value>{metric.unit}</Value>
            </Row>
          )}
          {metric.format && (
            <Row>
              <Label>Format</Label>
              <Value>{metric.format}</Value>
            </Row>
          )}
        </Side>
      </TopRow>
    </Wrap>
  );
}
