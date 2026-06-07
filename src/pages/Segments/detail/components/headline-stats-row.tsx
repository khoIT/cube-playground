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
import {
  Activity, BarChart3, Banknote, Clock, Coins, Percent, TrendingUp,
  User, UserMinus, Users, Wallet,
} from 'lucide-react';
import { Sparkline } from '../../visuals';
import type { Preset, KpiSpec } from '../../presets/types';
import type { Segment, RefreshLogRow } from '../../../../types/segment-api';
import { StatsRow, StatItem, StatCellInner, useStatItemFromKpi } from './stats-row';
import { formatCompact } from '../cards/format-value';
import styles from './stats-row.module.css';

type Tone = 'neutral' | 'positive' | 'negative';

const ICON_SIZE = 16;

/**
 * Map a headline KPI to a glyph by intent. Keyed off the spec id (stable
 * across presets) with a format-based fallback so auto-generated presets —
 * which have no curated id vocabulary — still get a sensible icon.
 */
function resolveKpiIcon(spec: KpiSpec): ReactNode {
  const id = spec.id.toLowerCase();
  if (id.includes('size') || id === 'users') return <Users size={ICON_SIZE} aria-hidden />;
  if (id.includes('payer') || id.includes('paying')) return <Wallet size={ICON_SIZE} aria-hidden />;
  if (id.includes('whale') || id.includes('arppu')) return <Coins size={ICON_SIZE} aria-hidden />;
  if (id.includes('arpu') || id.includes('ltv') || id.includes('rev')) return <Banknote size={ICON_SIZE} aria-hidden />;
  if (id.includes('lapsed') || id.includes('churn')) return <UserMinus size={ICON_SIZE} aria-hidden />;
  if (id.includes('rate') || spec.format === 'percent') return <Percent size={ICON_SIZE} aria-hidden />;
  if (id.includes('retention') || id.includes('active')) return <Activity size={ICON_SIZE} aria-hidden />;
  if (spec.format === 'currency') return <Banknote size={ICON_SIZE} aria-hidden />;
  return <TrendingUp size={ICON_SIZE} aria-hidden />;
}

interface Props {
  segment: Segment;
  preset: Preset | null;
  sizeComparison: { text: string; tone: Tone } | null;
  refreshLog: RefreshLogRow[] | undefined;
  lastRefresh: string | null | undefined;
  lastRefreshFooter: ReactNode;
  ownerFooter: ReactNode;
}

export function HeadlineStatsRow({
  segment, preset, sizeComparison, refreshLog, lastRefresh,
  lastRefreshFooter, ownerFooter,
}: Props): ReactElement {
  const { t } = useTranslation();

  if (preset && preset.headlineKpis.length > 0) {
    return (
      <div className={styles.statsRow} role="group" aria-label="Segment headline metrics">
        {preset.headlineKpis.map((spec) => (
          <div key={spec.id} className={styles.statCell}>
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
      icon: <Users size={ICON_SIZE} aria-hidden />,
      label: t('segments.detail.kpi.size', { defaultValue: 'Size' }),
      value: isRefreshing ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {formatCompact(segment.uid_count)}
          <LoadingOutlined spin style={{ fontSize: 14 }} />
        </span>
      ) : (
        <span title={`${segment.uid_count.toLocaleString('en-US')} users`}>
          {formatCompact(segment.uid_count)}
        </span>
      ),
      delta: sizeComparison?.text,
      tone: sizeComparison?.tone ?? 'neutral',
      footer: sizeSparkSeries.length >= 2
        ? <Sparkline data={sizeSparkSeries} height={16} />
        : null,
    },
    {
      id: 'last-refresh',
      icon: <Clock size={ICON_SIZE} aria-hidden />,
      label: t('segments.detail.kpi.lastRefresh', { defaultValue: 'Last refresh' }),
      value: lastRefresh
        ? formatDistanceToNowStrict(new Date(lastRefresh), { addSuffix: true })
        : '—',
      footer: lastRefreshFooter,
    },
    {
      id: 'owner',
      icon: <User size={ICON_SIZE} aria-hidden />,
      label: t('segments.detail.kpi.owner', { defaultValue: 'Owner' }),
      // owner is the Keycloak sub (a UUID on prod) — show the display label.
      value: segment.owner_label ?? segment.owner,
      footer: ownerFooter,
    },
    {
      id: 'status',
      icon: <BarChart3 size={ICON_SIZE} aria-hidden />,
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
        icon={resolveKpiIcon(spec)}
        label={spec.label}
        count={segment.uid_count}
        comparison={sizeComparison}
      />
    );
  }
  const item = useStatItemFromKpi(spec, segment, preset, `kpi:${spec.id}`, null);
  return (
    <StatCellInner
      icon={resolveKpiIcon(spec)}
      label={item.label}
      value={item.value}
      delta={item.delta}
      tone={item.tone}
      footer={item.footer}
    />
  );
}

/** Size cell rendered from segment.uid_count — exact thousands-separated value
 *  with the compact form ("82.4k") underneath for quick scanning. */
function SizeStatCell({
  icon, label, count, comparison,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  comparison: { text: string; tone: Tone } | null;
}): ReactElement {
  // Exact thousands-separated value up to 1M — precise counts beat compact
  // noise at this scale. From 1M up the tile compacts ("2.41M") and the
  // exact figure moves into the hover tooltip.
  const exact = count.toLocaleString('en-US');
  const display = count >= 1_000_000 ? formatCompact(count) : exact;
  return (
    <StatCellInner
      icon={icon}
      label={<span title={`${exact} users`}>{label}</span>}
      value={<span title={`${exact} users`}>{display}</span>}
      delta={comparison?.text}
      tone={comparison?.tone}
    />
  );
}

