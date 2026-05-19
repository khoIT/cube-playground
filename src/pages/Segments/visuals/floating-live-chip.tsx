import type { ReactElement } from 'react';
import styles from './visuals.module.css';

export interface FloatingLiveChipProps {
  /** Controls visibility — when false the chip is hidden but still in DOM. */
  visible: boolean;
  /** Refresh interval in minutes displayed inside the chip. */
  intervalMin: number;
}

/**
 * Small floating pill shown fixed/absolute over chart panels to indicate
 * real-time data refresh. Pointer-events are disabled so it never blocks interaction.
 */
export function FloatingLiveChip({ visible, intervalMin }: FloatingLiveChipProps): ReactElement {
  return (
    <span
      className={styles.floatingLiveChip}
      aria-hidden={!visible}
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 200ms' }}
    >
      <span className={styles.floatingLiveChipDot} />
      Live · {intervalMin}m
    </span>
  );
}
