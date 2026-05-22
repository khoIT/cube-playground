/**
 * Size KPI tile with attached uid_count sparkline (from refresh log) and a
 * refresh-now spinner overlay when the segment status is 'refreshing'.
 *
 * Used in the fallback KPI strip when no preset is installed; the preset
 * path delegates to a real Cube measure via KpiCard.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingOutlined } from '@ant-design/icons';
import { Sparkline, KpiTile } from '../../visuals';
import type { Segment, RefreshLogRow } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  comparison: { text: string; tone: 'positive' | 'negative' | 'neutral' } | null;
  refreshLog: RefreshLogRow[] | undefined;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function SizeKpiTile({ segment, comparison, refreshLog }: Props): ReactElement {
  const { t } = useTranslation();
  const isRefreshing = segment.status === 'refreshing';
  const series = (refreshLog ?? []).map((r) => r.uid_count);

  return (
    <div className={styles.sizeKpiWrap}>
      <KpiTile
        label={t('segments.detail.kpi.size', { defaultValue: 'Size' })}
        value={formatCount(segment.uid_count)}
        delta={comparison?.text}
        tone={comparison?.tone ?? 'neutral'}
        footer={
          series.length >= 2 ? (
            <div className={styles.sizeKpiSparkline} aria-hidden>
              <Sparkline data={series} height={20} />
            </div>
          ) : null
        }
      />
      {isRefreshing && (
        <div
          className={styles.sizeKpiOverlay}
          role="status"
          aria-label={t('segments.detail.kpi.refreshing', { defaultValue: 'Refreshing…' })}
        >
          <LoadingOutlined spin style={{ fontSize: 18 }} />
        </div>
      )}
    </div>
  );
}
