import type { ReactElement } from 'react';
import styles from './visuals.module.css';

export interface LiveBadgeProps {
  /** Display label after the pulsing dot. Defaults to "Live". */
  label?: string;
  /** Refresh interval in minutes shown as "· Xm". Omit to hide interval. */
  intervalMin?: number;
  size?: 'sm' | 'md';
}

/**
 * Green pulsing-dot badge indicating a live / auto-refreshing segment.
 * Colors are driven by --live-badge-* tokens.
 */
export function LiveBadge({ label = 'Live', intervalMin, size = 'md' }: LiveBadgeProps): ReactElement {
  const cls = [styles.liveBadge, size === 'sm' ? styles.liveBadgeSm : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} role="status" aria-label={`Live${intervalMin != null ? `, refreshes every ${intervalMin} minutes` : ''}`}>
      <span className={styles.liveDot} aria-hidden="true" />
      {label}
      {intervalMin != null && <span aria-hidden="true"> · {intervalMin}m</span>}
    </span>
  );
}
