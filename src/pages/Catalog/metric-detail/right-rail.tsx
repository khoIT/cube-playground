/**
 * Right-rail action buttons. "Open in Explore" is gated by the metric
 * runnability check: when the metric's formula refs are unresolved against
 * the active game's /meta, an inline yellow warning is shown and the
 * Explore button is disabled until the user clicks "Run anyway".
 */

import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import styled from 'styled-components';

import { pushFromMetric } from '../../../shared/activation/push-from-metric';
import { MetricRunnabilityWarning } from '../../../shared/concept-shell/metric-runnability-warning';
import { useMetricOverrideStore } from '../metrics-tab/metric-override-store';
import { SubscribeModal } from '../digest/subscribe-modal';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import { useCatalogMeta } from '../use-catalog-meta';
import { buildExploreUrl } from './explore-query-builder';
import { useMetricRunnability } from './use-metric-runnability';

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

  &:disabled {
    background: transparent;
    color: var(--text-muted, #737373);
    border-color: var(--border-card, #e5e5e5);
  }
`;

export function RightRail({ metric }: { metric: BusinessMetric }) {
  const history = useHistory();
  const { cubes } = useCatalogMeta();
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const runnability = useMetricRunnability(metric);
  const overridden = useMetricOverrideStore((s) => s.allowed.has(metric.id));
  const exploreBlocked = runnability.status === 'broken' && !overridden;

  return (
    <Rail>
      <MetricRunnabilityWarning metricId={metric.id} runnability={runnability} />
      <Primary
        type="button"
        disabled={exploreBlocked}
        onClick={() => {
          if (exploreBlocked) return;
          history.push(buildExploreUrl(metric, cubes));
        }}
        title={
          exploreBlocked
            ? `Refs unresolved: ${runnability.missingRefs.join(', ')}`
            : undefined
        }
      >
        Open in Explore →
      </Primary>
      <Button
        type="button"
        onClick={() => history.push(pushFromMetric(metric).url)}
        title="Hand off to Segments to materialise + push to activation"
      >
        Push to activation →
      </Button>
      <Button
        type="button"
        onClick={() => setSubscribeOpen(true)}
        title="Schedule Slack / email digest"
      >
        Subscribe
      </Button>
      <Button type="button" disabled title="Coming in a later phase">
        Edit
      </Button>
      {subscribeOpen && (
        <SubscribeModal metric={metric} onClose={() => setSubscribeOpen(false)} />
      )}
    </Rail>
  );
}
