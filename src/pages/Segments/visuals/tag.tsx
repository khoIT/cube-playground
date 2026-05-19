import type { ReactNode, ReactElement } from 'react';
import styles from './visuals.module.css';

export interface TagProps {
  children: ReactNode;
  onRemove?: () => void;
}

/** Neutral rounded chip for labels / category tags. */
export function Tag({ children, onRemove }: TagProps): ReactElement {
  return (
    <span className={styles.tag}>
      {children}
      {onRemove != null && (
        <button
          type="button"
          className={styles.tagRemove}
          onClick={onRemove}
          aria-label="Remove tag"
        >
          ×
        </button>
      )}
    </span>
  );
}
