/**
 * Fetches + shapes the Ops Console "power-up" series that sit alongside the core
 * billing trends: daily ad spend, daily active users (conversion denominator),
 * daily CS volume/sentiment, the payer-tier revenue concentration snapshot, and
 * the purchase hour×day-of-week heatmap.
 *
 * Split out of useOpsOverview to keep each hook focused (<200 LOC). All queries
 * are aggregate-only (no per-user dim) — the per-user members list lives in its
 * own hook. ARPPU + conversion are NOT computed here: they need the core daily
 * cash/payers series, so useOpsOverview derives them after composing this.
 *
 * Concurrency is bounded by useMemberCubeQuery's shared semaphore — these extra
 * queries queue, they don't stampede.
 */
import { useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { useMemberCubeQuery } from '../Segments/member360/use-member-cube-query';
import type { OpsRange } from './ops-window';
import { toNum } from './ops-format';
import {
  spendDailyTrendQuery,
  dauDailyQuery,
  csTrendDailyQuery,
  payerTierConcentrationQuery,
  purchaseHeatmapQuery,
} from './ops-overview-queries';

const K = {
  spendDay: 'marketing_cost.log_date.day',
  spend: 'marketing_cost.cost_vnd',
  dauDay: 'active_daily.log_date.day',
  dau: 'active_daily.dau',
  csDay: 'cs_ticket_detail.created_date.day',
  csTickets: 'cs_ticket_detail.total_tickets',
  csNegative: 'cs_ticket_detail.negative_sentiment_tickets',
  tier: 'mf_users.payer_tier',
  tierUsers: 'mf_users.user_count',
  tierLtv: 'mf_users.ltv_total_vnd',
  hour: 'billing_detail.hour_of_day',
  dow: 'billing_detail.day_of_week',
  cash: 'billing_detail.cash_charged_gross',
} as const;

export interface OpsTrendsData {
  loading: boolean;
  error: boolean;
  spendDaily: { date: string; spend: number }[];
  dauDaily: { date: string; dau: number }[];
  csDaily: { date: string; tickets: number; negative: number }[];
  /** Payer tiers with each tier's LTV as a share of the total (whale analysis). */
  payerTiers: { tier: string; count: number; ltv: number; ltvPct: number }[];
  /** Hour×DOW cash grid. EMPTY (not error) until the billing timing dims deploy. */
  heatmap: { hour: number; dow: number; cash: number }[];
  /** Exact queries for per-chart Open-in-Playground deeplinks. */
  queries: { spend: Query; dau: Query; cs: Query; payerTiers: Query; heatmap: Query };
}

const day = (v: unknown) => String(v ?? '').slice(0, 10);

export function useOpsTrends(gameId: string, range: OpsRange): OpsTrendsData {
  const q = useMemo(
    () => ({
      spend: spendDailyTrendQuery(range),
      dau: dauDailyQuery(range),
      cs: csTrendDailyQuery(range),
      payerTiers: payerTierConcentrationQuery(),
      heatmap: purchaseHeatmapQuery(gameId, range),
    }),
    [gameId, range],
  );

  const spend = useMemberCubeQuery(gameId, q.spend);
  const dau = useMemberCubeQuery(gameId, q.dau);
  const cs = useMemberCubeQuery(gameId, q.cs);
  const payerTiers = useMemberCubeQuery(gameId, q.payerTiers);
  const heatmap = useMemberCubeQuery(gameId, q.heatmap);

  return useMemo<OpsTrendsData>(() => {
    const spendDaily = spend.rows.map((r) => ({ date: day(r[K.spendDay]), spend: toNum(r[K.spend]) }));
    const dauDaily = dau.rows.map((r) => ({ date: day(r[K.dauDay]), dau: toNum(r[K.dau]) }));
    const csDaily = cs.rows.map((r) => ({
      date: day(r[K.csDay]),
      tickets: toNum(r[K.csTickets]),
      negative: toNum(r[K.csNegative]),
    }));

    const tierRows = payerTiers.rows.map((r) => ({
      tier: String(r[K.tier] ?? 'unknown'),
      count: toNum(r[K.tierUsers]),
      ltv: toNum(r[K.tierLtv]),
    }));
    const ltvTotal = tierRows.reduce((s, t) => s + t.ltv, 0);
    const tiers = tierRows
      .map((t) => ({ ...t, ltvPct: ltvTotal > 0 ? t.ltv / ltvTotal : 0 }))
      .sort((a, b) => b.ltv - a.ltv);

    const heat = heatmap.rows.map((r) => ({
      hour: toNum(r[K.hour]),
      dow: toNum(r[K.dow]),
      cash: toNum(r[K.cash]),
    }));

    return {
      // Heatmap is best-effort: its dimensions are deploy-gated, so a pre-deploy
      // error/load must NOT trip the Overview's global loading/error banner — the
      // heatmap card's own empty-state covers its absence. Excluded on purpose.
      loading: spend.loading || dau.loading || cs.loading || payerTiers.loading,
      error: Boolean(spend.error || dau.error || cs.error || payerTiers.error),
      spendDaily,
      dauDaily,
      csDaily,
      payerTiers: tiers,
      heatmap: heat,
      queries: { spend: q.spend, dau: q.dau, cs: q.cs, payerTiers: q.payerTiers, heatmap: q.heatmap },
    };
  }, [
    q.spend, q.dau, q.cs, q.payerTiers, q.heatmap,
    spend.rows, spend.loading, spend.error,
    dau.rows, dau.loading, dau.error,
    cs.rows, cs.loading, cs.error,
    payerTiers.rows, payerTiers.loading, payerTiers.error,
    heatmap.rows, heatmap.loading, heatmap.error,
  ]);
}
