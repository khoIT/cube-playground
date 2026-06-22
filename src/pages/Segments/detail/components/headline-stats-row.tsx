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
import { useSegmentScope } from '../segment-scope-context';
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
      <ScopedHeadlineKpis
        segment={segment}
        preset={preset}
        sizeComparison={sizeComparison}
      />
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

/** A headline KPI spec rewritten for the active scope, plus the flags the cell
 *  needs to fetch it correctly. */
interface ScopedKpi {
  spec: KpiSpec;
  /** Render Size live (paying count) instead of the server-authoritative uid_count. */
  renderSizeLive: boolean;
  /** Fetch this card outside the paying sub-scope (base-segment stat). */
  ignorePayingScope: boolean;
  /** Skip the precomputed full-segment cache (its numbers don't match this card). */
  suppressCache: boolean;
}

/** Rewrite a headline KPI for the active scope. Under "paying only" two cards
 *  go degenerate, so we repurpose them (decision: Paying users → Paying rate,
 *  ARPU → ARPPU) and let Size report the payer count live. Everything else is
 *  scope-invariant (LTV total, Whales, Lapsed are already payer-side) and just
 *  re-fetches under the sub-scope. */
function resolveScopedKpi(spec: KpiSpec, paying: boolean): ScopedKpi {
  if (!paying) {
    return { spec, renderSizeLive: false, ignorePayingScope: false, suppressCache: false };
  }
  if (spec.id === 'size') {
    return { spec, renderSizeLive: true, ignorePayingScope: false, suppressCache: true };
  }
  if (spec.id === 'paying') {
    // Share of the WHOLE segment that pays — the "you're viewing X% of the
    // segment" context. Scoped to payers it would always be 100%, so it opts
    // out of the sub-scope and reports the base rate.
    return {
      spec: { ...spec, label: 'Paying rate', measure: 'mf_users.paying_rate', format: 'percent' },
      renderSizeLive: false,
      ignorePayingScope: true,
      suppressCache: true,
    };
  }
  if (spec.id === 'arpu') {
    // Revenue ÷ payers == ARPPU; same number, now honestly named.
    return {
      spec: { ...spec, label: 'ARPPU', measure: 'mf_users.arppu_vnd' },
      renderSizeLive: false,
      ignorePayingScope: false,
      suppressCache: true,
    };
  }
  return { spec, renderSizeLive: false, ignorePayingScope: false, suppressCache: true };
}

/** Headline KPI grid that rewrites each spec for the active population scope. */
function ScopedHeadlineKpis({
  segment, preset, sizeComparison,
}: {
  segment: Segment;
  preset: Preset;
  sizeComparison: { text: string; tone: Tone } | null;
}): ReactElement {
  const { scope } = useSegmentScope();
  const paying = scope === 'paying';
  return (
    <div className={styles.statsRow} role="group" aria-label="Segment headline metrics">
      {preset.headlineKpis.map((spec) => {
        const resolved = resolveScopedKpi(spec, paying);
        return (
          <div key={spec.id} className={styles.statCell}>
            <InlineKpi
              resolved={resolved}
              segment={segment}
              preset={preset}
              sizeComparison={sizeComparison}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Inline preset-driven cell — same as StatsRow row but cell-scoped. */
function InlineKpi({
  resolved, segment, preset, sizeComparison,
}: {
  resolved: ScopedKpi;
  segment: Segment;
  preset: Preset;
  sizeComparison: { text: string; tone: Tone } | null;
}): ReactElement {
  const { spec, renderSizeLive, ignorePayingScope, suppressCache } = resolved;
  // Special-case the Size KPI (unscoped only): the segment object already
  // carries the true cohort count from the server-side refresh (Cube's
  // `total:true` defeats the 10k rowLimit). Running another measure query here
  // would be redundant and drift-prone. Under the paying sub-scope there is no
  // precomputed payer count, so Size falls through to a live measure query.
  if (spec.id === 'size' && !renderSizeLive) {
    return (
      <SizeStatCell
        icon={resolveKpiIcon(spec)}
        label={spec.label}
        count={segment.uid_count}
        comparison={sizeComparison}
      />
    );
  }
  const item = useStatItemFromKpi(
    spec,
    segment,
    preset,
    suppressCache ? undefined : `kpi:${spec.id}`,
    null,
    { ignorePayingScope },
  );
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

