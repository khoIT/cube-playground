import styled from 'styled-components';
import type { CubeApi } from '@cubejs-client/core';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { Operation } from '../../../types';
import { useColumnStats } from '../../hooks/use-column-stats';

const Card = styled.div`
  background: var(--bg-muted);
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-card);
  margin-bottom: 12px;
`;
const KpiLabel = styled.div`
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
`;
const KpiValue = styled.div`
  font-size: 22px;
  font-weight: 700;
  margin-top: 4px;
  color: var(--text-primary);
`;
const KpiSub = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
`;
const Section = styled.div`
  margin-top: 12px;
`;
const SectionLabel = styled.div`
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin-bottom: 8px;
`;
const Row = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-card);
  &:last-child { border-bottom: none; }
`;
const Mute = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
`;
const Callout = styled.div`
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  color: #92400e;
`;

function formatNumber(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString();
}

export type ColumnHealthRailProps = {
  cube: WizardCube | null;
  column: string | null;
  operation: Operation;
  cubeApi: CubeApi | null;
};

export function ColumnHealthRail({ cube, column, operation, cubeApi }: ColumnHealthRailProps) {
  const r = useColumnStats(cube, column, operation, cubeApi);

  if (!column) return <Mute>Pick a column to see its health profile.</Mute>;

  if (r.status === 'unavailable') {
    return (
      <Callout>
        Stats unavailable — {r.reason === 'no-count-measure'
          ? 'this cube has no `count` measure. Ask data team to add one.'
          : 'Cube API not configured.'}
      </Callout>
    );
  }
  if (r.status === 'error') {
    return <Callout>Stats query failed: {r.message}</Callout>;
  }
  if (r.status === 'idle' || r.status === 'loading') {
    return <Mute>{r.status === 'loading' ? 'Loading column health…' : 'Idle.'}</Mute>;
  }

  const d = r.data;
  return (
    <>
      <Card>
        <KpiLabel>{column.split('.').slice(-1)[0]}</KpiLabel>
        <KpiValue>{formatNumber(d.count)}</KpiValue>
        <KpiSub>row count on this cube</KpiSub>
      </Card>
      <Section>
        <SectionLabel>Data quality</SectionLabel>
        <Row>
          <span>Null %</span>
          <span style={{ color: (d.nullPct ?? 0) > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {d.nullPct == null ? '—' : `${d.nullPct.toFixed(2)}%`}
          </span>
        </Row>
        <Row>
          <span>Distinct (sample of 1k)</span>
          <span>{formatNumber(d.distinct)}</span>
        </Row>
        <Row>
          <span>Nulls</span>
          <span>{formatNumber(d.nullCount)}</span>
        </Row>
      </Section>
      <Section>
        <SectionLabel>Sample values</SectionLabel>
        {d.samples.length === 0 ? <Mute>No samples returned.</Mute> : d.samples.map((s, i) => (
          <Row key={i}><span style={{ fontFamily: 'var(--font-mono)' }}>{s}</span><span /></Row>
        ))}
      </Section>
    </>
  );
}
