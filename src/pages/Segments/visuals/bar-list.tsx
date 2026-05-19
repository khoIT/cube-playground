import type { ReactElement } from 'react';
import styles from './visuals.module.css';

export interface BarListItem {
  label: string;
  value: number;
  /** CSS color string. Defaults to var(--brand). */
  color?: string;
}

export interface BarListProps {
  items: BarListItem[];
  /** Explicit max value for bar width calc. Defaults to max of items. */
  max?: number;
}

/**
 * Horizontal proportional bar list used in composition cards and retention views.
 * Bar fill color resolves from item.color or falls back to --brand token.
 */
export function BarList({ items, max }: BarListProps): ReactElement {
  const maxVal = max ?? Math.max(...items.map((i) => i.value), 1);

  return (
    <div>
      {items.map((item, idx) => {
        const pct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
        const fillColor = item.color ?? 'var(--brand)';
        return (
          <div key={idx} className={styles.barListRow}>
            <span className={styles.barListLabel} title={item.label}>
              {item.label}
            </span>
            <div className={styles.barListTrack} role="meter" aria-valuenow={item.value} aria-valuemax={maxVal} aria-label={item.label}>
              <div
                className={styles.barListFill}
                style={{ width: `${pct}%`, background: fillColor }}
              />
            </div>
            <span className={styles.barListMeta}>
              {item.value.toLocaleString('en-US')}
            </span>
          </div>
        );
      })}
    </div>
  );
}
