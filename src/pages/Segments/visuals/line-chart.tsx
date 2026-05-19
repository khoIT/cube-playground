import type { ReactElement } from 'react';
import {
  LineChart as ReLineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface LineChartPoint {
  x: string | number;
  y: number;
}

export interface LineChartProps {
  data: LineChartPoint[];
  height?: number;
  /** CSS color string for line + area. Defaults to var(--brand). */
  color?: string;
  /** When true, renders a semi-transparent area fill under the line. */
  areaFill?: boolean;
}

/**
 * Recharts line/area chart wrapper for segment trend views.
 * Line and area stroke/fill are always driven by the color prop (no recharts defaults).
 */
export function LineChart({ data, height = 120, color = 'var(--brand)', areaFill = true }: LineChartProps): ReactElement {
  const chartData = data.map((d) => ({ x: d.x, y: d.y }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReLineChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 38 }}>
        <defs>
          <linearGradient id="line-chart-area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="0"
          vertical={false}
          stroke="var(--neutral-100)"
        />
        <XAxis
          dataKey="x"
          tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          tickLine={false}
          axisLine={false}
          width={34}
          tickFormatter={(v: number) => v.toLocaleString('en-US')}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            border: '1px solid var(--border-card)',
            borderRadius: 6,
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
          }}
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
        />
        {areaFill && (
          <Area
            type="monotone"
            dataKey="y"
            stroke="none"
            fill="url(#line-chart-area-fill)"
            isAnimationActive={false}
          />
        )}
        <Line
          type="monotone"
          dataKey="y"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </ReLineChart>
    </ResponsiveContainer>
  );
}
