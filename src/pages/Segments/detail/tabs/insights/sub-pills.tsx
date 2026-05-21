/**
 * Sub-pill strip inside Insights tab. Lists Overview/Engagement/Monetization/
 * Retention plus an optional 'saved' pinned-analyses pill. Hides pills with
 * no content.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../../../segments.module.css';

interface Pill {
  key: string;
  label: string;
}

interface Props {
  pills: Pill[];
  active: string | null;
  onChange: (id: string) => void;
}

export function SubPills({ pills, active, onChange }: Props): ReactElement {
  const { t } = useTranslation();
  if (pills.length === 0) return <></>;
  return (
    <div className={styles.subPills} role="tablist" aria-label={t('segments.detail.insights.subPills', { defaultValue: 'Insights sections' })}>
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          role="tab"
          aria-selected={active === p.key}
          className={[styles.subPill, active === p.key ? styles.subPillActive : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => onChange(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
