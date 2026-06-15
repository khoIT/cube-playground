/**
 * DigestPage — renders mock Slack + email previews from the subscribed
 * metrics. v1 is purely a demonstration — no delivery wiring. Each
 * subscription contributes one card per channel.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { useBusinessMetrics } from '../metrics-tab/use-business-metrics';
import { useSubscriptions } from '../../../shared/user-prefs/use-subscriptions';

const Page = styled.div`
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
`;

const Card = styled.div<{ $channel: 'slack' | 'email' }>`
  border: 1px solid var(--border-card);
  border-left: 4px solid
    ${(p) => (p.$channel === 'slack' ? '#611f69' : '#2563eb')};
  border-radius: 8px;
  background: var(--bg-card);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ChannelTag = styled.span`
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--text-muted);
`;

const Headline = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;

  a {
    color: var(--brand);
    text-decoration: none;
  }
`;

const Preview = styled.pre`
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  color: var(--text-secondary);
  background: var(--bg-app);
  border-radius: 6px;
  padding: 8px 10px;
  white-space: pre-wrap;
`;

const Empty = styled.div`
  padding: 30px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

function slackTemplate(label: string, cadence: string): string {
  return `:bar_chart: *${label}* — ${cadence} digest\n• value: 1,234,567\n• Δ vs prev period: +2.3%`;
}

function emailTemplate(label: string, cadence: string): string {
  return `Subject: ${label} (${cadence}) — week of ___\n\nThis is your scheduled metric digest.\n• Latest: 1,234,567\n• Trend: +2.3% w/w\n• Anomalies: 0 flagged`;
}

export function DigestPage() {
  const { subscriptions } = useSubscriptions();
  const { metrics } = useBusinessMetrics();
  const byId = new Map(metrics.map((m) => [m.id, m]));

  return (
    <Page>
      <Title>Metric digest</Title>
      <Hint>
        Preview-only. Real delivery to Slack / email is out of scope. Manage
        subscriptions from each metric's detail page.
      </Hint>
      {subscriptions.length === 0 ? (
        <Empty>
          No subscriptions yet.{' '}
          <Link to="/catalog">Browse metrics →</Link>
        </Empty>
      ) : (
        <Grid>
          {subscriptions.map((s, idx) => {
            const m = byId.get(s.metricId);
            const label = m?.label ?? s.metricId;
            const body =
              s.channel === 'slack'
                ? slackTemplate(label, s.cadence)
                : emailTemplate(label, s.cadence);
            return (
              <Card key={`${s.metricId}-${s.cadence}-${s.channel}-${idx}`} $channel={s.channel}>
                <ChannelTag>{s.channel} · {s.cadence}</ChannelTag>
                <Headline>
                  <Link to={`/catalog/metric/${s.metricId}`}>{label}</Link>
                </Headline>
                <Preview>{body}</Preview>
              </Card>
            );
          })}
        </Grid>
      )}
    </Page>
  );
}
