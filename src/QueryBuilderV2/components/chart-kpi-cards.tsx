import { ResultSet } from '@cubejs-client/core';
import styled from 'styled-components';

const Row = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
  padding: 8px 12px 12px 12px;
`;

const KpiCard = styled.div`
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  padding: 10px 12px;
  box-shadow: var(--shadow-xs);
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const Label = styled.span`
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Value = styled.span`
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
`;

type ChartKpiCardsProps = {
  resultSet: ResultSet<any> | null;
  isLoading: boolean;
};

const MAX_CARDS = 5;

function formatTotal(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function ChartKpiCards({ resultSet, isLoading }: ChartKpiCardsProps) {
  if (isLoading || !resultSet) return null;

  let series: ReturnType<ResultSet['series']> = [];
  try {
    series = resultSet.series();
  } catch {
    return null;
  }

  const cards = series.slice(0, MAX_CARDS).map((s) => {
    let total = 0;
    for (const point of s.series) {
      const n = Number((point as { value: unknown })?.value);
      if (Number.isFinite(n)) total += n;
    }
    return { key: s.key, title: s.title, total };
  });

  if (cards.length === 0) return null;

  return (
    <Row>
      {cards.map((c) => (
        <KpiCard key={c.key}>
          <Label title={c.title}>{c.title}</Label>
          <Value>{formatTotal(c.total)}</Value>
        </KpiCard>
      ))}
    </Row>
  );
}
