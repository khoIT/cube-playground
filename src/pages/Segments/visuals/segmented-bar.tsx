import type { ReactElement } from 'react';
import styles from './visuals.module.css';

const DEFAULT_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export interface SegmentedBarItem {
  label: string;
  value: number;
  /** Explicit CSS color. Falls back to DEFAULT_COLORS[i]. */
  color?: string;
}

export interface SegmentedBarProps {
  items: SegmentedBarItem[];
  /** Optional sub-line shown below the legend (e.g. "Avg LTV: $50.44"). */
  footer?: string;
  /** Minimum segment percent to render an inline % label. Defaults to 8. */
  inlineLabelThreshold?: number;
}

/**
 * Single horizontal stacked bar where each segment's width is proportional to
 * its share of the total. Each segment shows its % inline when wide enough;
 * a colour-coded legend with absolute % per category sits underneath.
 *
 * Used for Lifecycle stage / Spend tier composition strips on the segment
 * Insights tab where space is at a premium.
 */
export function SegmentedBar({
  items,
  footer,
  inlineLabelThreshold = 8,
}: SegmentedBarProps): ReactElement {
  const total = items.reduce((acc, it) => acc + Math.max(0, it.value), 0);

  if (total <= 0) {
    return (
      <div className={styles.segmentedBarEmpty}>No data.</div>
    );
  }

  const resolved = items.map((it, i) => {
    const pct = (Math.max(0, it.value) / total) * 100;
    return {
      ...it,
      pct,
      fill: it.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    };
  });

  return (
    <div className={styles.segmentedBarWrap}>
      <div
        className={styles.segmentedBarTrack}
        role="img"
        aria-label={resolved
          .map((s) => `${s.label} ${s.pct.toFixed(0)}%`)
          .join(', ')}
      >
        {resolved.map((s, i) => (
          <div
            key={i}
            className={styles.segmentedBarSeg}
            style={{ width: `${s.pct}%`, background: s.fill }}
            title={`${s.label} · ${s.value.toLocaleString('en-US')} (${s.pct.toFixed(1)}%)`}
          >
            {s.pct >= inlineLabelThreshold && (
              <span className={styles.segmentedBarLabel}>
                {s.pct.toFixed(0)}%
              </span>
            )}
          </div>
        ))}
      </div>
      <div className={styles.segmentedBarLegend}>
        {resolved.map((s, i) => (
          <span key={i} className={styles.segmentedBarLegendItem}>
            <span
              className={styles.segmentedBarSwatch}
              style={{ background: s.fill }}
              aria-hidden
            />
            <span className={styles.segmentedBarLegendLabel}>{s.label}</span>
            <span className={styles.segmentedBarLegendPct}>
              {s.pct.toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
      {footer != null && (
        <div className={styles.segmentedBarFooter}>{footer}</div>
      )}
    </div>
  );
}
