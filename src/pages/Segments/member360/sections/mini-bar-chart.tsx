/** Compact vertical bar chart (recharts) — daily recharge in the Journey row. */

import { useMemo, type ReactElement } from 'react';
import {
  BarChart as ReBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { makeTimeTickFormatter, formatChartDateTooltip } from '../../../../utils/format-chart-datetime-label';

export interface MiniBarPoint {
  x: string;
  y: number;
}

export function MiniBarChart({
  data,
  height = 160,
  color = 'var(--brand)',
}: {
  data: MiniBarPoint[];
  height?: number;
  color?: string;
}): ReactElement {
  const tickFormatter = useMemo(() => makeTimeTickFormatter(data.map((d) => d.x)), [data]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 38 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--neutral-100)" />
        <XAxis
          dataKey="x"
          tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          tickFormatter={tickFormatter}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          tickLine={false}
          axisLine={false}
          width={34}
          tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            border: '1px solid var(--border-card)',
            borderRadius: 6,
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
          }}
          cursor={{ fill: 'var(--bg-muted)' }}
          formatter={(v: number) => v.toLocaleString('en-US')}
          labelFormatter={(label: unknown) => formatChartDateTooltip(label)}
        />
        <Bar dataKey="y" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </ReBarChart>
    </ResponsiveContainer>
  );
}
