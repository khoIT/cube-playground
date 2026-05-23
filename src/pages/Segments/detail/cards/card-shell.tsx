/** Shared wrapper that gives chart cards a consistent header + body + loading
 *  state. Optional collapsible toggle stores per-card collapse state in
 *  localStorage so dashboards remember the user's preferred density.
 */

import { ReactNode, ReactElement } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCollapsiblePref } from './use-collapsible-pref';
import styles from '../../segments.module.css';

interface Props {
  title: string;
  loading?: boolean;
  error?: Error | null;
  /** Optional visual hint for the skeleton shape ('chart' | 'bars' | 'donut' | 'lines'). */
  skeletonShape?: 'chart' | 'bars' | 'donut' | 'lines';
  /** When set, the card is collapsible and persists its state under this key. */
  cardKey?: string;
  /** Default collapsed state on first render (when no stored value). */
  defaultCollapsed?: boolean;
  /** Optional trailing element rendered after the title (e.g. range select). */
  trailing?: ReactNode;
  children: ReactNode;
}

export function CardShell({
  title, loading, error, skeletonShape = 'chart', cardKey, defaultCollapsed,
  trailing, children,
}: Props): ReactElement {
  const collapsible = cardKey != null;
  const [collapsed, toggle] = useCollapsiblePref(cardKey, defaultCollapsed ?? false);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: collapsed ? 0 : 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
        {collapsible ? (
          <button
            type="button"
            className={styles.cardCollapseBtn}
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls={cardKey ? `card-body-${cardKey}` : undefined}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed
              ? <ChevronRight size={14} aria-hidden />
              : <ChevronDown size={14} aria-hidden />}
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {title}
            </h3>
          </button>
        ) : (
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {title}
          </h3>
        )}
        {trailing != null && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {trailing}
          </div>
        )}
      </div>
      {!collapsed && (
        <div id={cardKey ? `card-body-${cardKey}` : undefined}>
          {loading ? (
            <CardSkeleton shape={skeletonShape} />
          ) : error ? (
            <div style={{ fontSize: 12, color: 'var(--text-danger, #c0392b)' }}>{error.message}</div>
          ) : (
            children
          )}
        </div>
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
