import type { ReactElement } from 'react';
import { LineChart as ReLineChart, Line, ResponsiveContainer } from 'recharts';

export interface SparklineProps {
  /** Raw number array — index is x-axis, value is y-axis. */
  data: number[];
  height?: number;
  /** CSS color string. Defaults to var(--brand). */
  color?: string;
}

/**
 * Minimal inline sparkline for table rows and list items.
 * Uses recharts under the hood; stroke color is always explicitly set,
 * never the recharts default palette.
 */
export function Sparkline({ data, height = 22, color = 'var(--brand)' }: SparklineProps): ReactElement {
  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReLineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </ReLineChart>
    </ResponsiveContainer>
  );
}
