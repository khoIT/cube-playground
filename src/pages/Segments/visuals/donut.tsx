import type { ReactElement } from 'react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import styles from './visuals.module.css';

/** Default color palette — references chart tokens via CSS vars where possible. */
const DEFAULT_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export interface DonutSlice {
  label: string;
  value: number;
  /** Explicit CSS color. Falls back to DEFAULT_COLORS[i]. */
  color?: string;
}

export interface DonutProps {
  data: DonutSlice[];
  /** Outer diameter in px. Defaults to 132. */
  size?: number;
  legendPosition?: 'right' | 'bottom';
}

/**
 * Recharts PieChart donut wrapper.
 * All slice colors come from props or the --chart-* token set;
 * recharts default fill is never used.
 */
export function Donut({ data, size = 132, legendPosition = 'right' }: DonutProps): ReactElement {
  const thickness = 18;
  const inner = size / 2 - thickness;
  const outer = size / 2;

  const resolvedData = data.map((d, i) => ({
    ...d,
    fill: d.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
  }));

  const chart = (
    <PieChart width={size} height={size}>
      <Pie
        data={resolvedData}
        dataKey="value"
        nameKey="label"
        innerRadius={inner}
        outerRadius={outer}
        strokeWidth={0}
        isAnimationActive={false}
      >
        {resolvedData.map((entry, i) => (
          <Cell key={i} fill={entry.fill} />
        ))}
      </Pie>
      <Tooltip
        formatter={(val: number) => val.toLocaleString('en-US')}
        contentStyle={{ fontSize: 12, border: '1px solid var(--border-card)', borderRadius: 6 }}
      />
    </PieChart>
  );

  if (legendPosition === 'bottom') {
    return (
      <div>
        {chart}
        <div className={styles.donutLegendBottom}>
          {resolvedData.map((d, i) => (
            <span key={i} className={styles.donutLegendRow}>
              <span className={styles.donutLegendSwatch} style={{ background: d.fill }} />
              {d.label}
              <span className={styles.donutLegendValue}>{d.value.toLocaleString('en-US')}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.compositionDonutRow}>
      {chart}
      <div className={styles.donutLegend}>
        {resolvedData.map((d, i) => (
          <span key={i} className={styles.donutLegendRow}>
            <span className={styles.donutLegendSwatch} style={{ background: d.fill }} />
            <span>{d.label}</span>
            <span className={styles.donutLegendValue}>{d.value.toLocaleString('en-US')}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
