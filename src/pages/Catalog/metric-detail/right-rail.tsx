/**
 * Right-rail action buttons. "Open in Explore" is gated by the metric
 * runnability check: when the metric's formula refs are unresolved against
 * the active game's /meta, the button is disabled. The yellow warning
 * strip itself is rendered at full content width by TabOverview, so the
 * rail can stay slim and focused on actions.
 */

import { useHistory } from 'react-router-dom';
import styled from 'styled-components';

import { useMetricOverrideStore } from '../metrics-tab/metric-override-store';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import { useCatalogMeta } from '../use-catalog-meta';
import { buildExploreUrl } from './explore-query-builder';
import { useMetricRunnability } from './use-metric-runnability';

const Rail = styled.aside`
  width: 240px;
  padding: 16px 14px;
  border-left: 1px solid var(--border-card);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Button = styled.button`
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;

  &:hover { border-color: var(--brand); }
  &:disabled {
    color: var(--text-muted);
    cursor: not-allowed;
    border-style: dashed;
  }
`;

const Primary = styled(Button)`
  background: var(--brand);
  color: white;
  border-color: var(--brand);

  &:hover { background: var(--brand-hover); }

  &:disabled {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border-card);
  }
`;

export function RightRail({ metric }: { metric: BusinessMetric }) {
  const history = useHistory();
  const { cubes } = useCatalogMeta();
  const runnability = useMetricRunnability(metric);
  const overridden = useMetricOverrideStore((s) => s.allowed.has(metric.id));
  const exploreBlocked = runnability.status === 'broken' && !overridden;

  return (
    <Rail>
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
      <Button type="button" disabled title="Coming in a later phase">
        Push to activation →
      </Button>
      <Button type="button" disabled title="Coming in a later phase">
        Subscribe
      </Button>
      <Button type="button" disabled title="Coming in a later phase">
        Edit
      </Button>
    </Rail>
  );
}
