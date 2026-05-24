/**
 * MetricSparkline — visual surface for `useMetricSparkline`. Renders an
 * inline recharts trend with a "first → last %" delta chip on the right
 * and a small caption (e.g. "Last 30 days · 28 points").
 *
 * States:
 *   - draft   → friendly "Sparkline unavailable while refs are missing"
 *   - idle    → muted "Connect to Cube to see trend"
 *   - loading → animated skeleton bars
 *   - empty   → "No data returned for the window"
 *   - error   → red one-line error
 *   - success → trend + delta chip
 */
import { useMemo } from 'react';
import styled from 'styled-components';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { SparklineResult } from './use-metric-sparkline';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';

const Card = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 4px 16px;
  padding: 14px 16px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(240, 90, 34, 0.03), rgba(240, 90, 34, 0));
  margin-bottom: 18px;
`;

const Caption = styled.div`
  grid-column: 1;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #737373);
`;

const Chip = styled.div<{ tone: 'up' | 'down' | 'flat' }>`
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: ${({ tone }) =>
    tone === 'up' ? 'rgba(34, 197, 94, 0.12)' : tone === 'down' ? 'rgba(220, 38, 38, 0.10)' : 'rgba(0,0,0,0.05)'};
  color: ${({ tone }) =>
    tone === 'up' ? '#15803d' : tone === 'down' ? '#b91c1c' : 'var(--text-muted, #737373)'};
`;

const ChartBox = styled.div`
  grid-column: 1;
  height: 64px;
`;

const Placeholder = styled.div`
  grid-column: 1;
  height: 64px;
  border-radius: 6px;
  background: repeating-linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04) 0px,
    rgba(0, 0, 0, 0.04) 8px,
    rgba(0, 0, 0, 0.02) 8px,
    rgba(0, 0, 0, 0.02) 16px
  );
`;

const Message = styled.div<{ tone?: 'muted' | 'error' }>`
  grid-column: 1;
  height: 64px;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-style: italic;
  color: ${({ tone }) => (tone === 'error' ? '#b91c1c' : 'var(--text-muted, #737373)')};
`;

interface Props {
  metric: BusinessMetric;
  result: SparklineResult;
  disabled?: boolean;
}

export function MetricSparkline({ metric, result, disabled = false }: Props) {
  const tone: 'up' | 'down' | 'flat' = useMemo(() => {
    if (result.deltaPct == null) return 'flat';
    if (result.deltaPct > 1) return 'up';
    if (result.deltaPct < -1) return 'down';
    return 'flat';
  }, [result.deltaPct]);

  const captionLabel = useMemo(() => {
    if (result.status === 'success') {
      return `Last 30 days · ${result.points.length} points · ${result.seriesLabel}`;
    }
    return 'Last 30 days';
  }, [result.status, result.points.length, result.seriesLabel]);

  return (
    <Card aria-label={`Sparkline for ${metric.label}`}>
      <Caption>{captionLabel}</Caption>
      {renderBody(disabled, result)}
      {result.status === 'success' && result.deltaPct != null && (
        <Chip tone={tone} title="Change from first to last bucket">
          {result.deltaPct > 0 ? '+' : ''}
          {result.deltaPct.toFixed(1)}%
        </Chip>
      )}
    </Card>
  );
}

function renderBody(disabled: boolean, result: SparklineResult) {
  if (disabled) {
    return (
      <Message tone="muted">
        Sparkline unavailable while metric refs are missing. Resolve the schema or click “Run anyway”.
      </Message>
    );
  }
  if (result.status === 'idle') {
    return <Message tone="muted">Connect to Cube to load the last-30-day trend.</Message>;
  }
  if (result.status === 'loading') {
    return <Placeholder aria-hidden />;
  }
  if (result.status === 'empty') {
    return <Message tone="muted">No data returned for the last 30 days.</Message>;
  }
  if (result.status === 'error') {
    return <Message tone="error">Failed to load trend: {result.error}</Message>;
  }

  const showDots = result.points.length <= 10;

  return (
    <ChartBox>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={result.points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <XAxis dataKey="x" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            cursor={{ stroke: 'var(--border-card, #e5e5e5)' }}
            labelFormatter={(label: string) => formatTooltipDate(label)}
            formatter={(value: number) => [formatNumber(value), 'value']}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Line
            type="monotone"
            dataKey="y"
            stroke="var(--brand, #f05a22)"
            strokeWidth={2}
            dot={showDots ? { r: 2.5, fill: 'var(--brand, #f05a22)' } : false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

function formatTooltipDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
