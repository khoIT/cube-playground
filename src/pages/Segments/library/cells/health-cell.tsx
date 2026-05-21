/**
 * Health cell: colored dot + 2-line stack (label + secondary).
 * Mapping rules from brainstorm §5 / phase-03:
 *   predicate + fresh   → success — "Fresh" — "Live · {cadence}m cadence"
 *   predicate + stale   → warning — "Stale" — "Live · {cadence}m · refresh overdue"
 *   predicate + broken  → destructive — "Broken" — broken_reason
 *   manual              → muted — "Static" — "Manual upload"
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { Segment } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

type Tone = 'success' | 'warning' | 'destructive' | 'muted';

function resolve(segment: Segment, t: (k: string, opts?: Record<string, unknown>) => string): {
  tone: Tone;
  label: string;
  sub: string;
} {
  if (segment.type === 'manual') {
    return {
      tone: 'muted',
      label: t('segments.library.health.static.label', { defaultValue: 'Static' }),
      sub: t('segments.library.health.static.sub', { defaultValue: 'Manual upload' }),
    };
  }
  if (segment.status === 'broken') {
    return {
      tone: 'destructive',
      label: t('segments.library.health.broken.label', { defaultValue: 'Broken' }),
      sub: segment.broken_reason || t('segments.library.health.broken.sub', { defaultValue: 'Refresh failed' }),
    };
  }
  const cadence = segment.refresh_cadence_min ?? null;
  const liveLabel = cadence != null
    ? t('segments.library.health.live.cadence', { defaultValue: 'Live · {{cadence}}m cadence', cadence })
    : t('segments.library.health.live.noCadence', { defaultValue: 'Live · on demand' });
  if (segment.status === 'stale') {
    return {
      tone: 'warning',
      label: t('segments.library.health.stale.label', { defaultValue: 'Stale' }),
      sub: cadence != null
        ? t('segments.library.health.stale.sub', { defaultValue: 'Live · {{cadence}}m · refresh overdue', cadence })
        : t('segments.library.health.stale.subNoCadence', { defaultValue: 'Refresh overdue' }),
    };
  }
  return {
    tone: 'success',
    label: t('segments.library.health.fresh.label', { defaultValue: 'Fresh' }),
    sub: liveLabel,
  };
}

export function HealthCell({ segment }: Props): ReactElement {
  const { t } = useTranslation();
  const { tone, label, sub } = resolve(segment, t as never);

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
