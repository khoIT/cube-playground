import type { ReactNode, ReactElement } from 'react';
import styles from './visuals.module.css';

export interface SelectionBarProps {
  /** Number of selected items shown in the count badge. */
  count: number;
  /** Action buttons rendered in the right section of the bar. */
  actions: ReactNode;
  onDismiss?: () => void;
}

/**
 * Sticky bottom dark action bar shown when rows are selected in the library.
 * Matches the mock's .selection-bar pattern.
 */
export function SelectionBar({ count, actions, onDismiss }: SelectionBarProps): ReactElement {
  return (
    <div className={styles.selectionBar} role="toolbar" aria-label={`${count} items selected`}>
      <span className={styles.selectionCount}>
        <strong className={styles.selectionCountBadge}>{count}</strong>
        {count === 1 ? 'segment selected' : 'segments selected'}
      </span>
      <span className={styles.selectionGrow} />
      {actions}
      {onDismiss != null && (
        <>
          <span className={styles.selectionDivider} aria-hidden="true" />
          <button
            type="button"
            className={styles.barBtn}
            onClick={onDismiss}
            aria-label="Dismiss selection"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}
