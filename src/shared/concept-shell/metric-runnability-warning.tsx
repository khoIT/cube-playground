/**
 * Inline yellow warning strip rendered above a Run / Explore button when a
 * business metric's formula refs are unresolved against the active game's
 * /meta. Includes a "Run anyway" button that flips the per-session override
 * for this metric.
 *
 * Renders nothing when status === 'ok' so callers can mount it unconditionally.
 */

import styled from 'styled-components';

import { useMetricOverrideStore } from '../../pages/Catalog/metrics-tab/metric-override-store';
import type { MetricRunnability } from '../../pages/Catalog/metric-detail/use-metric-runnability';

const Strip = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid #f0c674;
  background: #fff8e1;
  border-radius: 6px;
  font-size: 12px;
  color: #6b4f0a;
  line-height: 1.45;
`;

const Icon = styled.span`
  flex: 0 0 auto;
  font-size: 14px;
  line-height: 1;
`;

const Body = styled.div`
  flex: 1 1 auto;
`;

const RefList = styled.code`
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  background: rgba(0, 0, 0, 0.04);
  padding: 1px 4px;
  border-radius: 3px;
`;

const RunAnyway = styled.button`
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: 1px solid #c89a3a;
  background: #fff;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 500;
  color: #6b4f0a;
  cursor: pointer;

  &:hover { background: #fdf3d2; }
`;

interface Props {
  metricId: string;
  runnability: MetricRunnability;
}

export function MetricRunnabilityWarning({ metricId, runnability }: Props) {
  const isAllowed = useMetricOverrideStore((s) => s.allowed.has(metricId));
  const allow = useMetricOverrideStore((s) => s.allow);

  if (runnability.status === 'ok' || isAllowed) return null;

  return (
    <Strip role="alert" aria-live="polite">
      <Icon aria-hidden>⚠</Icon>
      <Body>
        This metric is currently a <strong>draft</strong> — the Cube schema is
        missing:{' '}
        {runnability.missingRefs.map((ref, i) => (
          <span key={ref}>
            <RefList>{ref}</RefList>
            {i < runnability.missingRefs.length - 1 ? ', ' : ''}
          </span>
        ))}
        . Running it will fail with a UserError.
      </Body>
      <RunAnyway type="button" onClick={() => allow(metricId)}>
        Run anyway
      </RunAnyway>
    </Strip>
  );
}
