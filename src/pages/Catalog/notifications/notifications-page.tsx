/**
 * NotificationsPage — reads live anomaly state (P8) and surfaces it as a
 * scannable list. Click a row to jump to the metric detail.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { useAnomalyState } from '../../../shared/concept-shell/use-anomaly-state';
import { useBusinessMetrics } from '../metrics-tab/use-business-metrics';

const Page = styled.div`
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Row = styled.li`
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-card, #ffffff);

  a {
    color: var(--brand, #f05a22);
    text-decoration: none;
    font-weight: 500;
  }
`;

const State = styled.span<{ $state: string }>`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 999px;
  background: ${(p) => {
    if (p.$state === 'high') return 'rgba(239,68,68,0.14)';
    if (p.$state === 'low') return 'rgba(245,158,11,0.14)';
    if (p.$state === 'trend') return 'rgba(168,85,247,0.14)';
    return 'rgba(115,115,115,0.10)';
  }};
  color: ${(p) => {
    if (p.$state === 'high') return '#b91c1c';
    if (p.$state === 'low') return '#b45309';
    if (p.$state === 'trend') return '#7e22ce';
    return '#525252';
  }};
`;

const Empty = styled.div`
  padding: 28px;
  text-align: center;
  color: var(--text-muted, #737373);
  font-size: 13px;
`;

export function NotificationsPage() {
  const { states, loading } = useAnomalyState();
  const { metrics } = useBusinessMetrics();
  const byId = new Map(metrics.map((m) => [m.id, m]));

  const flagged = Object.entries(states).filter(
    ([, v]) => v && v.state && v.state !== 'none',
  );

  return (
    <Page>
      <Title>Notifications</Title>
      {loading && <Empty>Loading anomaly state…</Empty>}
      {!loading && flagged.length === 0 && <Empty>No flagged anomalies for this game.</Empty>}
      {!loading && flagged.length > 0 && (
        <List>
          {flagged.map(([metricId, a]) => {
            const m = byId.get(metricId);
            return (
              <Row key={metricId}>
                <State $state={a.state}>{a.state}</State>
                <Link to={`/catalog/metric/${metricId}`}>{m?.label ?? metricId}</Link>
                {a.deltaPct !== undefined && (
                  <span style={{ fontSize: 12, color: '#737373' }}>
                    {a.deltaPct >= 0 ? '+' : ''}{a.deltaPct.toFixed(1)}%
                    {a.period ? ` · ${a.period}` : ''}
                  </span>
                )}
              </Row>
            );
          })}
        </List>
      )}
    </Page>
  );
}
