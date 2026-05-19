import type { ReactNode, ReactElement } from 'react';
import styles from './visuals.module.css';

export type MemberPillVariant = 'measure' | 'dimension' | 'segment' | 'time';

export interface MemberPillProps {
  variant: MemberPillVariant;
  children: ReactNode;
  onClose?: () => void;
}

/** Color-coded pill for QueryBuilder member types inside segment predicates. */
export function MemberPill({ variant, children, onClose }: MemberPillProps): ReactElement {
  const inlineStyle: React.CSSProperties = {
    background: `var(--member-pill-${variant}-bg)`,
    color: `var(--member-pill-${variant}-text)`,
  };

  return (
    <span className={styles.memberPill} style={inlineStyle}>
      {children}
      {onClose != null && (
        <button
          type="button"
          className={styles.memberPillClose}
          onClick={onClose}
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </span>
  );
}
