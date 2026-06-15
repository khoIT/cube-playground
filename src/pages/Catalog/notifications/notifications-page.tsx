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
  border: 1px solid var(--border-card);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-card);

  a {
    color: var(--brand);
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
    if (p.$state === 'high') return 'var(--cat-red-ink)';
    if (p.$state === 'low') return 'var(--cat-amber-ink)';
    if (p.$state === 'trend') return 'var(--cat-purple-ink)';
    return 'var(--cat-grey-ink)';
  }};
`;

const Empty = styled.div`
  padding: 28px;
  text-align: center;
  color: var(--text-muted);
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
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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
