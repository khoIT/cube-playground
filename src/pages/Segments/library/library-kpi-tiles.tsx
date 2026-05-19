/** Top KPI strip in the Segments Library. */

import { ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { KpiTile } from '../visuals';
import type { Segment } from '../../../types/segment-api';
import styles from '../segments.module.css';

interface Props {
  segments: Segment[];
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function LibraryKpiTiles({ segments }: Props): ReactElement {
  const { t } = useTranslation();

  const totals = useMemo(() => {
    let live = 0;
    let staticCount = 0;
    let uids = 0;
    for (const s of segments) {
      if (s.type === 'predicate') live += 1;
      else staticCount += 1;
      uids += s.uid_count ?? 0;
    }
    return { live, staticCount, uids };
  }, [segments]);

  return (
    <div className={styles.kpiGrid}>
      <KpiTile label={t('segments.library.kpi.live')} value={totals.live} />
      <KpiTile label={t('segments.library.kpi.static')} value={totals.staticCount} />
      <KpiTile label={t('segments.library.kpi.totalUids')} value={formatCount(totals.uids)} />
      <KpiTile label={t('segments.library.kpi.inUse')} value={0} footer="v1.5" />
    </div>
  );
}
