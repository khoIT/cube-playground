import type { ReactElement } from 'react';
import styles from './visuals.module.css';

export interface PredicatePillProps {
  /** Cube member name, e.g. "users.country" */
  member: string;
  /** Operator string, e.g. "equals", "contains", ">" */
  op: string;
  /** Value string, e.g. "VN" */
  value: string;
  onEdit?: () => void;
  onRemove?: () => void;
}

/** Compact pill representing a single predicate leaf in the segment filter tree. */
export function PredicatePill({ member, op, value, onEdit, onRemove }: PredicatePillProps): ReactElement {
  return (
    <span className={styles.predicatePill}>
      {onEdit != null ? (
        <button
          type="button"
          className={`${styles.predicateAction} ${styles.predicateMember}`}
          onClick={onEdit}
          aria-label={`Edit condition: ${member} ${op} ${value}`}
          title="Edit"
        >
          {member}
        </button>
      ) : (
        <span className={styles.predicateMember}>{member}</span>
      )}
      <span className={styles.predicateOp}>{op}</span>
      <span className={styles.predicateValue}>{value}</span>
      {onRemove != null && (
        <button
          type="button"
          className={`${styles.predicateAction} ${styles.predicateRemove}`}
          onClick={onRemove}
          aria-label={`Remove condition: ${member} ${op} ${value}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
