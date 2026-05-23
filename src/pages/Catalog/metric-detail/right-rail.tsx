/**
 * Right-rail action buttons. Only "Open in Explore" is functional in P3 — the
 * other three buttons stub their delivery phase in the tooltip.
 */

import { useHistory } from 'react-router-dom';
import styled from 'styled-components';

import { pushFromMetric } from '../../../shared/activation/push-from-metric';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';

const Rail = styled.aside`
  width: 240px;
  padding: 16px 14px;
  border-left: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-card, #ffffff);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Button = styled.button`
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary, #171717);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;

  &:hover { border-color: var(--brand, #f05a22); }
  &:disabled {
    color: var(--text-muted, #737373);
    cursor: not-allowed;
    border-style: dashed;
  }
`;

const Primary = styled(Button)`
  background: var(--brand, #f05a22);
  color: white;
  border-color: var(--brand, #f05a22);

  &:hover { background: var(--brand-pressed, #f54a00); }
`;

function exploreUrlFor(metric: BusinessMetric): string {
  const measures: string[] = [];
  const f = metric.formula;
  if (f.type === 'measure') measures.push(f.ref);
  if (f.type === 'ratio') measures.push(f.numerator, f.denominator);
  if (f.type === 'expression' && f.inputs) measures.push(...f.inputs);
  const query = { measures, timeDimensions: [], filters: [], order: {} };
  return `/build?query=${encodeURIComponent(JSON.stringify(query))}`;
}

export function RightRail({ metric }: { metric: BusinessMetric }) {
  const history = useHistory();
  return (
    <Rail>
      <Primary type="button" onClick={() => history.push(exploreUrlFor(metric))}>
        Open in Explore →
      </Primary>
      <Button
        type="button"
        onClick={() => history.push(pushFromMetric(metric).url)}
        title="Hand off to Segments to materialise + push to activation"
      >
        Push to activation →
      </Button>
      <Button type="button" disabled title="Coming in Phase 9">
        Subscribe
      </Button>
      <Button type="button" disabled title="Coming in Phase 6">
        Edit
      </Button>
    </Rail>
  );
}
