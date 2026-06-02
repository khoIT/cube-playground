/**
 * Health cell: colored dot + 2-line stack (label + secondary).
 * Presentation is resolved by the shared resolveSegmentHealth() so this list
 * column and the detail-header pill can never disagree (e.g. a manual upload
 * reads "Static" in both places, never "fresh").
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { Segment } from '../../../../types/segment-api';
import { resolveSegmentHealth } from '../../status/segment-health';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

export function HealthCell({ segment }: Props): ReactElement {
  const { t } = useTranslation();
  const { tone, label, sub } = resolveSegmentHealth(segment, t as never);

  return (
    <div className={styles.healthCell} data-tone={tone}>
      <span className={styles.healthDot} aria-hidden />
      <span className={styles.healthStack}>
        <span className={styles.healthLabel}>{label}</span>
        <span className={styles.healthSub}>{sub}</span>
      </span>
    </div>
  );
}
