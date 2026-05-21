/**
 * Trend cell: inline 80×28 SVG sparkline rendered from refresh-log rows.
 * Renders `—` for empty / static / single-point series.
 */

import { ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RefreshLogRow } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  log: RefreshLogRow[] | undefined;
  isStatic?: boolean;
}

const W = 80;
const H = 28;
const PAD_X = 2;
const PAD_Y = 4;

function buildPath(values: number[]): string {
  if (values.length < 2) return '';
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1, maxV - minV);
  const stepX = (W - PAD_X * 2) / (values.length - 1);

  const points = values.map((v, i) => {
    const x = PAD_X + i * stepX;
    const norm = (v - minV) / range;
    const y = H - PAD_Y - norm * (H - PAD_Y * 2);
    return { x, y };
  });

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return d;
}

export function TrendCell({ log, isStatic }: Props): ReactElement {
  const { t } = useTranslation();
  const series = useMemo(() => (log ?? []).map((r) => r.uid_count), [log]);
  const path = useMemo(() => buildPath(series), [series]);

  if (isStatic || series.length < 2 || !path) {
    return <span className={styles.cellEmpty}>—</span>;
  }

  const first = series[0];
  const last = series[series.length - 1];
  const delta = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  const ariaLabel = t('segments.library.trend.aria', {
    defaultValue: 'Size trend {{delta}}% over {{points}} refreshes',
    delta,
    points: series.length,
  });

  return (
    <svg
      className={styles.trendSparkline}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
    >
      <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
