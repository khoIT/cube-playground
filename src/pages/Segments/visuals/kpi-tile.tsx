import type { ReactNode, ReactElement } from 'react';
import styles from './visuals.module.css';

export type KpiTone = 'neutral' | 'positive' | 'negative';

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  /** Optional delta string e.g. "+12.3%" — tone controls color. */
  delta?: string;
  /** Tone determines delta color: positive=green, negative=red, neutral=muted. */
  tone?: KpiTone;
  footer?: ReactNode;
}

const deltaClass: Record<KpiTone, string> = {
  positive: styles.kpiDeltaPositive,
  negative: styles.kpiDeltaNegative,
  neutral:  styles.kpiDeltaNeutral,
};

/** Label / value / delta tile used in segment detail header and library KPI strip. */
export function KpiTile({ label, value, delta, tone = 'neutral', footer }: KpiTileProps): ReactElement {
  return (
    <div className={styles.kpiTile}>
      <p className={styles.kpiLabel}>{label}</p>
      <p className={styles.kpiValue}>{value}</p>
      {delta != null && (
        <span className={`${styles.kpiDelta} ${deltaClass[tone]}`} aria-label={`Change: ${delta}`}>
          {delta}
        </span>
      )}
      {footer != null && <p className={styles.kpiFooter}>{footer}</p>}
    </div>
  );
}
