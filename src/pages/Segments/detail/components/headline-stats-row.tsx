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
  Activity, BarChart3, Banknote, Clock, Coins, DollarSign, HandCoins, Percent,
  TrendingUp, User, UserMinus, Users, Wallet,
} from 'lucide-react';
import { Sparkline } from '../../visuals';
import { WhaleIcon } from './whale-icon';
import type { Preset, KpiSpec } from '../../presets/types';
import type { Segment, RefreshLogRow } from '../../../../types/segment-api';
import { StatsRow, StatItem, StatCellInner, MiniStatCell, useStatItemFromKpi } from './stats-row';
import { formatCompact } from '../cards/format-value';
import { useSegmentScope } from '../segment-scope-context';
import type { HeadlineDelta } from './use-headline-deltas';
import styles from './stats-row.module.css';

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
  if (id.includes('whale')) return <WhaleIcon size={ICON_SIZE} />;
  if (id.includes('arppu')) return <Coins size={ICON_SIZE} aria-hidden />;
  if (id.includes('arpu')) return <HandCoins size={ICON_SIZE} aria-hidden />;
  if (id.includes('ltv') || id.includes('rev')) return <DollarSign size={ICON_SIZE} aria-hidden />;
  if (id.includes('lapsed') || id.includes('churn')) return <UserMinus size={ICON_SIZE} aria-hidden />;
  if (id.includes('rate') || spec.format === 'percent') return <Percent size={ICON_SIZE} aria-hidden />;
  if (id.includes('retention') || id.includes('active')) return <Activity size={ICON_SIZE} aria-hidden />;
  if (spec.format === 'currency') return <Banknote size={ICON_SIZE} aria-hidden />;
  return <TrendingUp size={ICON_SIZE} aria-hidden />;
}

interface Props {
  segment: Segment;
  preset: Preset | null;
  /** Per-card vs-yesterday movement, keyed by KPI id (see useHeadlineDeltas). */
  deltas: Map<string, HeadlineDelta>;
  refreshLog: RefreshLogRow[] | undefined;
  lastRefresh: string | null | undefined;
  lastRefreshFooter: ReactNode;
  ownerFooter: ReactNode;
  /** Collapsed → render the condensed inline strip instead of the card grid.
   *  Same cells/hooks either way, so values fetch once and never diverge. */
  collapsed?: boolean;
}

export function HeadlineStatsRow({
  segment, preset, deltas, refreshLog, lastRefresh,
  lastRefreshFooter, ownerFooter, collapsed = false,
}: Props): ReactElement {
  const { t } = useTranslation();

  if (preset && preset.headlineKpis.length > 0) {
    return (
      <ScopedHeadlineKpis
        segment={segment}
        preset={preset}
        deltas={deltas}
        collapsed={collapsed}
      />
    );
  }

  const sizeDelta = deltas.get('size') ?? null;

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
      delta: sizeDelta?.text,
      tone: sizeDelta?.tone ?? 'neutral',
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

  return <StatsRow items={items} mini={collapsed} />;
}

/** A headline KPI spec rewritten for the active scope, plus the flags the cell
 *  needs to fetch it correctly. */
interface ScopedKpi {
  spec: KpiSpec;
  /** Fetch this card outside the paying sub-scope (base-segment stat). */
  ignorePayingScope: boolean;
  /** Skip the precomputed full-segment cache (its numbers don't match this card). */
  suppressCache: boolean;
}

/** Rewrite a headline KPI for the active scope. Under "paying only" two cards
 *  go degenerate, so we repurpose them (decision: Paying users → Paying rate,
 *  ARPU → ARPPU). Everything else is scope-invariant (LTV total, Whales, Lapsed
 *  are already payer-side) and just re-fetches under the sub-scope. Size always
 *  resolves to a live measure query — like every other card — so the headline
 *  row stays internally consistent (never paying > size off a stale count). */
function resolveScopedKpi(spec: KpiSpec, paying: boolean): ScopedKpi {
  if (!paying) {
    // Size hydrates from the precomputed `kpi:size` cache when present, else
    // fetches live — same lane as the other cards. The stored uid_count still
    // backs the Members tab / Pull API (the materialized snapshot), which is why
    // the Members list carries its own "as of last refresh" stamp.
    return { spec, ignorePayingScope: false, suppressCache: false };
  }
  if (spec.id === 'size') {
    // No precomputed payer count exists, so size fetches live under the sub-scope.
    return { spec, ignorePayingScope: false, suppressCache: true };
  }
  if (spec.id === 'paying') {
    // Share of the WHOLE segment that pays — the "you're viewing X% of the
    // segment" context. Scoped to payers it would always be 100%, so it opts
    // out of the sub-scope and reports the base rate.
    return {
      spec: { ...spec, label: 'Paying rate', measure: 'mf_users.paying_rate', format: 'percent' },
      ignorePayingScope: true,
      suppressCache: true,
    };
  }
  if (spec.id === 'arpu') {
    // Revenue ÷ payers == ARPPU; same number, now honestly named.
    return {
      spec: { ...spec, label: 'ARPPU', measure: 'mf_users.arppu_vnd' },
      ignorePayingScope: false,
      suppressCache: true,
    };
  }
  return { spec, ignorePayingScope: false, suppressCache: true };
}

/** Headline KPI grid that rewrites each spec for the active population scope.
 *  Collapsed → condensed inline strip; cells (and their fetches) are identical. */
function ScopedHeadlineKpis({
  segment, preset, deltas, collapsed,
}: {
  segment: Segment;
  preset: Preset;
  deltas: Map<string, HeadlineDelta>;
  collapsed: boolean;
}): ReactElement {
  const { scope } = useSegmentScope();
  const paying = scope === 'paying';
  const cells = preset.headlineKpis.map((spec) => (
    <InlineKpi
      key={spec.id}
      resolved={resolveScopedKpi(spec, paying)}
      segment={segment}
      preset={preset}
      delta={deltas.get(spec.id) ?? null}
      mini={collapsed}
    />
  ));
  if (collapsed) {
    return (
      <div className={styles.statsMini} role="group" aria-label="Segment headline metrics">
        {cells}
      </div>
    );
  }
  return (
    <div className={styles.statsRow} role="group" aria-label="Segment headline metrics">
      {preset.headlineKpis.map((spec, i) => (
        <div key={spec.id} className={styles.statCell}>{cells[i]}</div>
      ))}
    </div>
  );
}

/** Inline preset-driven cell — same as StatsRow row but cell-scoped.
 *  `mini` renders the condensed strip cell (no card chrome, no icon). */
function InlineKpi({
  resolved, segment, preset, delta, mini,
}: {
  resolved: ScopedKpi;
  segment: Segment;
  preset: Preset;
  delta: HeadlineDelta | null;
  mini: boolean;
}): ReactElement {
  const { spec, ignorePayingScope, suppressCache } = resolved;
  // Size resolves through the same live lane as every other card (see
  // resolveScopedKpi) so the headline row can't show paying > size off a stale
  // stored count. The materialized uid_count still backs the Members tab, which
  // carries its own "as of last refresh" stamp.
  const item = useStatItemFromKpi(
    spec,
    segment,
    preset,
    suppressCache ? undefined : `kpi:${spec.id}`,
    null,
    { ignorePayingScope },
  );
  // The vs-yesterday delta (from snapshot movement) overrides any spec-level
  // comparison — it's the merged Monitor detail now riding the headline.
  if (mini) {
    // Strip the "vs yesterday" suffix — repeated across six cells it's noise;
    // the basis is given once by the section, not per number.
    const miniDelta = (delta?.text ?? item.delta)?.replace(' vs yesterday', '');
    return (
      <MiniStatCell label={item.label} value={item.value} delta={miniDelta} tone={delta?.tone ?? item.tone} />
    );
  }
  return (
    <StatCellInner
      icon={resolveKpiIcon(spec)}
      label={item.label}
      value={item.value}
      delta={delta?.text ?? item.delta}
      tone={delta?.tone ?? item.tone}
      footer={item.footer}
    />
  );
}

