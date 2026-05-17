import { Suspense, lazy } from 'react';
import styled from 'styled-components';
import type { DimensionResult } from './use-test-run';

const ResponsiveContainer = lazy(() =>
  import('recharts').then((m) => ({ default: m.ResponsiveContainer })),
);
const AreaChart = lazy(() => import('recharts').then((m) => ({ default: m.AreaChart })));
const Area = lazy(() => import('recharts').then((m) => ({ default: m.Area })));
const XAxis = lazy(() => import('recharts').then((m) => ({ default: m.XAxis })));
const YAxis = lazy(() => import('recharts').then((m) => ({ default: m.YAxis })));
const Tooltip = lazy(() => import('recharts').then((m) => ({ default: m.Tooltip })));
const CartesianGrid = lazy(() => import('recharts').then((m) => ({ default: m.CartesianGrid })));

const Card = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  min-height: 280px;
`;
const CardHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;
const CardTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
`;
const TabRow = styled.div`
  display: flex;
  gap: 4px;
`;
const Tab = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  border-radius: 999px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'white' : 'var(--text-secondary)')};
  cursor: pointer;
  &:hover { background: ${(p) => (p.$active ? 'var(--brand)' : 'var(--bg-muted)')}; }
`;
const ChartArea = styled.div`
  flex: 1;
  min-height: 200px;
`;
const Empty = styled.div`
  color: var(--text-muted);
  font-size: 12.5px;
  text-align: center;
  padding: 32px 0;
`;
const Table = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  row-gap: 10px;
  column-gap: 12px;
  font-size: 13px;
  padding-top: 4px;
`;
const HeaderCell = styled.div`
  text-transform: uppercase;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
`;
const Cell = styled.div`
  color: var(--text-primary);
`;
const ShareBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;
const Bar = styled.div<{ $pct: number }>`
  width: 56px;
  height: 6px;
  background: var(--bg-muted);
  border-radius: 3px;
  position: relative;
  overflow: hidden;
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    width: ${(p) => Math.min(100, Math.max(0, p.$pct))}%;
    background: var(--brand);
  }
`;

export type TrendChartProps = {
  data: Array<{ x: string; y: number }> | null;
  loading: boolean;
  rangeLabel: string;
};

function formatShort(d: string): string {
  // ISO dates → "MMM d"; fallback unchanged.
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function TrendChart({ data, loading, rangeLabel }: TrendChartProps) {
  return (
    <Card>
      <CardHead>
        <CardTitle>Daily trend</CardTitle>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{rangeLabel}</span>
      </CardHead>
      <ChartArea>
        {loading && <Empty>Loading…</Empty>}
        {!loading && (!data || data.length === 0) && <Empty>No data points returned.</Empty>}
        {!loading && data && data.length > 0 && (
          <Suspense fallback={<Empty>Loading chart…</Empty>}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" vertical={false} />
                <XAxis
                  dataKey="x"
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  tickFormatter={formatShort}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  tickFormatter={formatCompact}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(v: number) => formatCompact(v)}
                  labelFormatter={(l: string) => formatShort(l)}
                />
                <Area
                  type="monotone"
                  dataKey="y"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  fill="url(#trend-fill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Suspense>
        )}
      </ChartArea>
    </Card>
  );
}

export type DimensionTableProps = {
  result: DimensionResult;
  dimensions: string[];
  activeDimension: string | null;
  onPick: (qualifiedDim: string) => void;
};

function leafOf(qualified: string): string {
  return qualified.includes('.') ? qualified.split('.').slice(-1)[0] : qualified;
}

export function DimensionTable({ result, dimensions, activeDimension, onPick }: DimensionTableProps) {
  return (
    <Card>
      <CardHead>
        <CardTitle>By dimension</CardTitle>
        <TabRow>
          {dimensions.slice(0, 3).map((d) => (
            <Tab key={d} $active={d === activeDimension} onClick={() => onPick(d)}>
              {leafOf(d)}
            </Tab>
          ))}
        </TabRow>
      </CardHead>
      {!activeDimension && <Empty>No dimensions available on this cube.</Empty>}
      {activeDimension && result.status === 'loading' && <Empty>Loading…</Empty>}
      {activeDimension && result.status === 'error' && (
        <Empty style={{ color: 'var(--danger)' }}>{result.error ?? 'Query failed'}</Empty>
      )}
      {activeDimension && result.status === 'success' && result.rows.length === 0 && (
        <Empty>No rows returned.</Empty>
      )}
      {activeDimension && result.status === 'success' && result.rows.length > 0 && (
        <Table>
          <HeaderCell>{leafOf(activeDimension)}</HeaderCell>
          <HeaderCell style={{ textAlign: 'right' }}>Metric</HeaderCell>
          <HeaderCell style={{ textAlign: 'right' }}>Share</HeaderCell>
          {result.rows.slice(0, 8).map((r) => (
            <Row key={r.label} label={r.label} value={r.value} share={r.share} />
          ))}
        </Table>
      )}
    </Card>
  );
}

function Row({ label, value, share }: { label: string; value: number; share: number }) {
  const pct = Math.round(share * 100);
  return (
    <>
      <Cell style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{label}</Cell>
      <Cell style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCompact(value)}</Cell>
      <Cell style={{ textAlign: 'right' }}>
        <ShareBar style={{ justifyContent: 'flex-end' }}>
          <Bar $pct={pct} />
          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 32 }}>{pct}%</span>
        </ShareBar>
      </Cell>
    </>
  );
}
