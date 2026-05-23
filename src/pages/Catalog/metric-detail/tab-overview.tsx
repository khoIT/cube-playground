import styled from 'styled-components';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';

const Wrap = styled.section`
  padding: 20px 24px;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 24px;
`;

const Body = styled.div`
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary, #525252);
`;

const Side = styled.aside`
  border-left: 1px solid var(--border-card, #e5e5e5);
  padding-left: 20px;
  font-size: 12px;
`;

const Row = styled.div`
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
`;

const Label = styled.span`
  color: var(--text-muted, #737373);
`;

const Sparkline = styled.div`
  height: 80px;
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
  color: var(--text-muted, #737373);
  font-size: 12px;
  font-style: italic;
`;

export function TabOverview({ metric }: { metric: BusinessMetric }) {
  return (
    <Wrap>
      <Body>
        <Sparkline>Sparkline — coming in Phase 8</Sparkline>
        <p>{metric.description}</p>
        {metric.synonyms && metric.synonyms.length > 0 && (
          <p>
            <Label>Also known as: </Label>
            <code>{metric.synonyms.join(', ')}</code>
          </p>
        )}
      </Body>
      <Side>
        <Row>
          <Label>Tier</Label>
          <span>T{metric.tier}</span>
        </Row>
        <Row>
          <Label>Domain</Label>
          <span>{metric.domain}</span>
        </Row>
        <Row>
          <Label>Owner</Label>
          <span>{metric.owner}</span>
        </Row>
        <Row>
          <Label>Trust</Label>
          <span>{metric.trust}</span>
        </Row>
        {metric.unit && (
          <Row>
            <Label>Unit</Label>
            <span>{metric.unit}</span>
          </Row>
        )}
        {metric.format && (
          <Row>
            <Label>Format</Label>
            <span>{metric.format}</span>
          </Row>
        )}
      </Side>
    </Wrap>
  );
}
