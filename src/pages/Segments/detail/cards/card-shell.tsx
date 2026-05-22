/** Shared wrapper that gives chart cards a consistent header + body + loading state. */

import { ReactNode, ReactElement } from 'react';
import styles from '../../segments.module.css';

interface Props {
  title: string;
  loading?: boolean;
  error?: Error | null;
  /** Optional visual hint for the skeleton shape ('chart' | 'bars' | 'donut' | 'lines'). */
  skeletonShape?: 'chart' | 'bars' | 'donut' | 'lines';
  children: ReactNode;
}

export function CardShell({ title, loading, error, skeletonShape = 'chart', children }: Props): ReactElement {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {loading ? (
        <CardSkeleton shape={skeletonShape} />
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--text-danger, #c0392b)' }}>{error.message}</div>
      ) : (
        children
      )}
    </div>
  );
}

function CardSkeleton({ shape }: { shape: NonNullable<Props['skeletonShape']> }): ReactElement {
  if (shape === 'bars') {
    return (
      <div className={styles.cardSkeleton}>
        {[0.9, 0.7, 0.55, 0.4, 0.3].map((w, i) => (
          <div
            key={i}
            className={styles.cardSkeletonBar}
            style={{ width: `${w * 100}%` }}
          />
        ))}
      </div>
    );
  }
  if (shape === 'donut') {
    return (
      <div className={styles.cardSkeleton}>
        <div className={styles.cardSkeletonDonut} />
      </div>
    );
  }
  if (shape === 'lines') {
    return (
      <div className={styles.cardSkeleton}>
        <div className={styles.cardSkeletonLine} />
      </div>
    );
  }
  return (
    <div className={styles.cardSkeleton}>
      <div className={styles.cardSkeletonBlock} />
    </div>
  );
}
