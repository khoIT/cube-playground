import styled from 'styled-components';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import type { DimensionResult } from './use-test-run';

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
  gap: 12px;
  margin-bottom: 12px;
`;
const StackedHead = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
`;
const StackedTitleRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
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
  min-height: 220px;
`;
const ChartCanvas = styled.div`
  width: 100%;
  height: 220px;
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
          <ChartCanvas>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                  dataKey="x"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={formatShort}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
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
                  stroke="#f97316"
                  strokeWidth={2}
                  fill="url(#trend-fill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCanvas>
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
      <StackedHead>
        <StackedTitleRow>
          <CardTitle>By dimension</CardTitle>
          {activeDimension && (
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              top {Math.min(8, result.rows.length)} of {result.rows.length}
            </span>
          )}
        </StackedTitleRow>
        <TabRow>
          {dimensions.slice(0, 3).map((d) => (
            <Tab key={d} $active={d === activeDimension} onClick={() => onPick(d)}>
              {leafOf(d)}
            </Tab>
          ))}
        </TabRow>
      </StackedHead>
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
