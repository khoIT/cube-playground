import type { ReactElement } from 'react';
import styles from './visuals.module.css';

export interface LiveBannerProps {
  message: string;
  /** Refresh interval in minutes shown in monospace. */
  intervalMin: number;
  onPause?: () => void;
}

/**
 * Inline green banner indicating the segment is live-refreshing.
 * Placed at the top of detail views.
 */
export function LiveBanner({ message, intervalMin, onPause }: LiveBannerProps): ReactElement {
  return (
    <div className={styles.liveBanner} role="status">
      <span className={styles.liveBannerDot} aria-hidden="true" />
      <span>
        <strong>{message}</strong>
        {' — refreshes every '}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{intervalMin}m</span>
      </span>
      <span className={styles.liveBannerGrow} />
      {onPause != null && (
        <button type="button" className={styles.liveBannerBtn} onClick={onPause}>
          Pause
        </button>
      )}
    </div>
  );
}
