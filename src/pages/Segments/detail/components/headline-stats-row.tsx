/**
 * Headline stats row wrapper — resolves a preset's headlineKpis or the
 * fallback set (Size / Last refresh / Owner / Status) into a StatItem[]
 * and renders them inline via <StatsRow>. Replaces the legacy 4-cell
 * KPI strip.
 *
 * Each cell is rendered by its own component (live cube fetches must use
 * hooks); a single shell loops over the resolved cells.
 */

import { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import { LoadingOutlined } from '@ant-design/icons';
import { Sparkline } from '../../visuals';
import type { Preset, KpiSpec } from '../../presets/types';
import type { Segment, RefreshLogRow } from '../../../../types/segment-api';
import { StatsRow, StatItem, useStatItemFromKpi } from './stats-row';
import styles from './stats-row.module.css';

type Tone = 'neutral' | 'positive' | 'negative';

interface Props {
  segment: Segment;
  preset: Preset | null;
  sizeComparison: { text: string; tone: Tone } | null;
  refreshLog: RefreshLogRow[] | undefined;
  lastRefresh: string | null | undefined;
  lastRefreshFooter: ReactNode;
  ownerFooter: ReactNode;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function HeadlineStatsRow({
  segment, preset, sizeComparison, refreshLog, lastRefresh,
  lastRefreshFooter, ownerFooter,
}: Props): ReactElement {
  const { t } = useTranslation();

  if (preset && preset.headlineKpis.length > 0) {
    return (
      <div className={styles.statsRow} role="group" aria-label="Segment headline metrics">
        {preset.headlineKpis.map((spec, idx) => (
          <div key={spec.id} className={styles.statCell} data-divider={idx > 0 ? 'true' : 'false'}>
            <InlineKpi spec={spec} segment={segment} preset={preset} sizeComparison={sizeComparison} />
          </div>
        ))}
      </div>
    );
  }

  // Fallback: no preset — synthesize Size / Last refresh / Owner / Status.
  const sizeSparkSeries = (refreshLog ?? []).map((r) => r.uid_count);
  const isRefreshing = segment.status === 'refreshing';

  const items: StatItem[] = [
    {
      id: 'size',
      label: t('segments.detail.kpi.size', { defaultValue: 'Size' }),
      value: isRefreshing ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {formatCount(segment.uid_count)}
          <LoadingOutlined spin style={{ fontSize: 14 }} />
        </span>
      ) : formatCount(segment.uid_count),
      delta: sizeComparison?.text,
      tone: sizeComparison?.tone ?? 'neutral',
      footer: sizeSparkSeries.length >= 2
        ? <Sparkline data={sizeSparkSeries} height={16} />
        : null,
    },
    {
      id: 'last-refresh',
      label: t('segments.detail.kpi.lastRefresh', { defaultValue: 'Last refresh' }),
      value: lastRefresh
        ? formatDistanceToNowStrict(new Date(lastRefresh), { addSuffix: true })
        : '—',
      footer: lastRefreshFooter,
    },
    {
      id: 'owner',
      label: t('segments.detail.kpi.owner', { defaultValue: 'Owner' }),
      value: segment.owner,
      footer: ownerFooter,
    },
    {
      id: 'status',
      label: t('segments.detail.kpi.status', { defaultValue: 'Status' }),
      value: segment.status,
    },
  ];

  return <StatsRow items={items} />;
}

/** Inline preset-driven cell — same as StatsRow row but cell-scoped. */
function InlineKpi({
  spec, segment, preset, sizeComparison,
}: {
  spec: KpiSpec;
  segment: Segment;
  preset: Preset;
  sizeComparison: { text: string; tone: Tone } | null;
}): ReactElement {
  // Special-case the Size KPI: the segment object already carries the true
  // cohort count from the server-side refresh (which uses Cube's `total:true`
  // to defeat the 10k rowLimit). Running another measure query here would be
  // both redundant and prone to drift — the IN-filter version can return
  // stale FE-cached values when Cube is still warming a pre-aggregation.
  if (spec.id === 'size') {
    return (
      <SizeStatCell
        label={spec.label}
        count={segment.uid_count}
        comparison={sizeComparison}
      />
    );
  }
  const item = useStatItemFromKpi(spec, segment, preset, `kpi:${spec.id}`, null);
  return (
    <>
      <div className={styles.label}>{item.label}</div>
      <div className={styles.valueRow}>
        <span className={styles.value}>{item.value}</span>
        {item.delta != null && (
          <span className={styles.delta} data-tone={item.tone ?? 'neutral'}>
            {item.delta}
          </span>
        )}
      </div>
      {item.footer != null && <div className={styles.footer}>{item.footer}</div>}
    </>
  );
}

/** Size cell rendered from segment.uid_count — exact thousands-separated value
 *  with the compact form ("82.4k") underneath for quick scanning. */
function SizeStatCell({
  label, count, comparison,
}: {
  label: string;
  count: number;
  comparison: { text: string; tone: Tone } | null;
}): ReactElement {
  const exact = count.toLocaleString('en-US');
  const compact = formatCount(count);
  const showCompact = compact !== exact;
  return (
    <>
      <div className={styles.label}>{label}</div>
      <div className={styles.valueRow}>
        <span className={styles.value} title={`${exact} users`}>{exact}</span>
        {comparison?.text != null && (
          <span className={styles.delta} data-tone={comparison.tone}>
            {comparison.text}
          </span>
        )}
      </div>
      {showCompact && <div className={styles.footer}>{compact}</div>}
    </>
  );
}

