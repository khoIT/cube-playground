/**
 * Orchestrates the Overview's aggregate Cube queries for one game + window.
 *
 * All queries are aggregate-only (no user_id filter / PII dim) → no per-user rows
 * → no PII. paying_users is queried once over the window (non-additive; the daily
 * series is display-only). Δ-vs-prior is computed only when a prior range exists
 * (7d). Snapshot tiles (lifetime / ingame LTV / geo) ignore the window.
 *
 * Concurrency is bounded by useMemberCubeQuery's shared semaphore.
 */
import { useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { useMemberCubeQuery } from '../Segments/member360/use-member-cube-query';
import {
  opsWindowRanges,
  pctDelta,
  type OpsWindow,
  type OpsPresetWindow,
  type OpsRange,
} from './ops-window';
import { toNum } from './ops-format';
import { useOpsTrends } from './use-ops-trends';
import {
  billingHeadlineQuery,
  billingDailyTrendQuery,
  gatewayTrendQuery,
  supportQuery,
  lifetimeQuery,
  ingameLtvQuery,
  geoQuery,
  acquisitionQuery,
} from './ops-overview-queries';

// Gateway colours — assigned by descending total so the biggest is the brand hue.
const GATEWAY_PALETTE = ['var(--brand)', '#3f8dff', '#10b981', '#a855f7', '#facc15', '#94a3b8'];

const M = {
  cash: 'billing_detail.cash_charged_gross',
  txn: 'billing_detail.txn_count_total',
  payers: 'billing_detail.paying_users',
  gateway: 'billing_detail.payment_gateway',
  day: 'billing_detail.order_date.day',
} as const;

export interface OpsOverviewData {
  loading: boolean;
  /** True when any underlying query errored (e.g. a renamed/missing measure) —
   *  so the UI shows a failure state instead of silent zeros. */
  error: boolean;
  headline: {
    cash: number;
    txns: number;
    payers: number;
    cashDelta: number | null;
    txnsDelta: number | null;
    payersDelta: number | null;
  };
  daily: { date: string; cash: number; txn: number; payers: number }[];
  /** Daily ad spend (for the spend-vs-cash ROAS chart). */
  spendDaily: { date: string; spend: number }[];
  /** Daily active users (conversion denominator). */
  dauDaily: { date: string; dau: number }[];
  /** Daily CS volume + negative-sentiment (own ~2d-lagged date spine). */
  csDaily: { date: string; tickets: number; negative: number }[];
  /** Per-date ARPPU (cash/payers) + payer conversion (payers/dau), null-safe. */
  arppuConversionDaily: { date: string; arppu: number | null; conversionPct: number | null }[];
  /** Payer tiers with each tier's LTV share (whale concentration). */
  payerTiers: { tier: string; count: number; ltv: number; ltvPct: number }[];
  /** Purchase hour×DOW cash grid — empty until billing timing dims deploy. */
  heatmap: { hour: number; dow: number; cash: number }[];
  /** The exact Cube queries feeding the trend charts — for per-chart
   *  "Open in Playground" deeplinks. daily feeds the cash line + the
   *  cash-vs-payers dual + the ARPPU/conversion derivation; gatewayTrend feeds
   *  the gateway-mix stack; the rest map 1:1 to their charts. */
  queries: {
    daily: Query;
    gatewayTrend: Query;
    spend: Query;
    dau: Query;
    cs: Query;
    payerTiers: Query;
    heatmap: Query;
  };
  gatewayDays: Record<string, number>[];
  /** Sorted day keys aligned 1:1 with gatewayDays (for the x-axis). */
  gatewayDates: string[];
  gateways: { key: string; color: string }[];
  gatewayMix: { gateway: string; cash: number; pct: number }[];
  support: {
    tickets: number;
    csat: number;
    negative: number;
    unresolvedMember: number;
    avgResolution: number;
  };
  recon: { gatewayLifetime: number; ingameLtv: number; gapPct: number | null };
  geo: { movers: number; base: number; moverLtv: number; moverPct: number | null };
  acquisition: {
    spend: number;
    cpc: number;
    cpm: number;
    clicks: number;
    /** ROAS numerator — the window's VND cash collected (jus is VND-filtered). */
    revenue: number;
    blendedRoas: number | null;
  };
}

export function useOpsOverview(
  gameId: string,
  window: OpsWindow,
  customRange?: OpsRange,
): OpsOverviewData {
  // Daily-stable "today": rolls over at UTC midnight but is constant within a day
  // so the memoised ranges/queries don't refetch every render (a raw new Date()
  // in deps would loop).
  const todayKey = new Date().toISOString().slice(0, 10);
  // Custom carries its range out-of-band and has no prior period (no Δ — same
  // rationale as 30d/MTD: a synthetic prior window before billing history is
  // empty). Presets go through the pure opsWindowRanges.
  const customStart = customRange?.start;
  const customEnd = customRange?.end;
  const ranges = useMemo(() => {
    if (window === 'custom' && customStart && customEnd) {
      return { current: { start: customStart, end: customEnd }, prior: null };
    }
    const preset: OpsPresetWindow = window === 'custom' ? '30d' : window;
    return opsWindowRanges(preset, new Date(`${todayKey}T00:00:00Z`));
  }, [window, customStart, customEnd, todayKey]);

  // Power-up series (spend / dau / cs / payer-tiers / heatmap).
  const trends = useOpsTrends(gameId, ranges.current);

  const q = useMemo(
    () => ({
      headline: billingHeadlineQuery(gameId, ranges.current),
      prior: ranges.prior ? billingHeadlineQuery(gameId, ranges.prior) : null,
      daily: billingDailyTrendQuery(gameId, ranges.current),
      gatewayTrend: gatewayTrendQuery(gameId, ranges.current),
      support: supportQuery(ranges.current),
      lifetime: lifetimeQuery(),
      ingameLtv: ingameLtvQuery(),
      geo: geoQuery(),
      acquisition: acquisitionQuery(ranges.current),
    }),
    [gameId, ranges],
  );

  const headline = useMemberCubeQuery(gameId, q.headline);
  const prior = useMemberCubeQuery(gameId, q.prior);
  const daily = useMemberCubeQuery(gameId, q.daily);
  const gatewayTrend = useMemberCubeQuery(gameId, q.gatewayTrend);
  const support = useMemberCubeQuery(gameId, q.support);
  const lifetime = useMemberCubeQuery(gameId, q.lifetime);
  const ingameLtv = useMemberCubeQuery(gameId, q.ingameLtv);
  const geo = useMemberCubeQuery(gameId, q.geo);
  const acquisition = useMemberCubeQuery(gameId, q.acquisition);

  return useMemo<OpsOverviewData>(() => {
    const h0 = headline.rows[0] ?? {};
    const p0 = prior.rows[0];
    const cash = toNum(h0[M.cash]);
    const txns = toNum(h0[M.txn]);
    const payers = toNum(h0[M.payers]);

    const dailyRows = daily.rows.map((r) => ({
      date: String(r[M.day] ?? '').slice(0, 10),
      cash: toNum(r[M.cash]),
      txn: toNum(r[M.txn]),
      payers: toNum(r[M.payers]),
    }));

    // Gateway-mix-over-time → per-day {gateway: cash} + per-gateway totals.
    const byDay = new Map<string, Record<string, number>>();
    const totals = new Map<string, number>();
    for (const r of gatewayTrend.rows) {
      const date = String(r[M.day] ?? '').slice(0, 10);
      const gw = String(r[M.gateway] ?? 'unknown');
      const v = toNum(r[M.cash]);
      if (!byDay.has(date)) byDay.set(date, {});
      byDay.get(date)![gw] = (byDay.get(date)![gw] ?? 0) + v;
      totals.set(gw, (totals.get(gw) ?? 0) + v);
    }
    const sortedGw = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const gateways = sortedGw.map(([key], i) => ({
      key,
      color: GATEWAY_PALETTE[i] ?? GATEWAY_PALETTE[GATEWAY_PALETTE.length - 1],
    }));
    const gatewayDates = [...byDay.keys()].sort();
    const gatewayDays = gatewayDates.map((d) => byDay.get(d)!);
    const mixTotal = sortedGw.reduce((s, [, v]) => s + v, 0);
    const gatewayMix = sortedGw.map(([gateway, c]) => ({
      gateway,
      cash: c,
      pct: mixTotal > 0 ? c / mixTotal : 0,
    }));

    const s0 = support.rows[0] ?? {};
    const lf0 = lifetime.rows[0] ?? {};
    const il0 = ingameLtv.rows[0] ?? {};
    const gatewayLifetime = toNum(lf0['billing_lifetime.lifetime_vnd_total']);
    const ingameLtvTotal = toNum(il0['mf_users.ltv_total_vnd']);

    // Cross-border: split mf_users rows by geo_moved.
    let movers = 0;
    let base = 0;
    let moverLtv = 0;
    for (const r of geo.rows) {
      const moved = String(r['mf_users.geo_moved']) === 'true';
      const users = toNum(r['mf_users.user_count']);
      const ltv = toNum(r['mf_users.ltv_total_vnd']);
      if (moved) {
        movers += users;
        moverLtv += ltv;
      } else {
        base += users;
      }
    }

    const a0 = acquisition.rows[0] ?? {};
    const spend = toNum(a0['marketing_cost.cost_vnd']);
    // ROAS numerator = the window's VND cash (already fetched, jus VND-filtered).
    // cfm's revenue_vnd_real reconciles to gateway cash; jus has no trustworthy
    // recharge-revenue measure and recharge.revenue_vnd is banned (inflated), so
    // gateway cash is the honest, available numerator for both games.
    const revenue = cash;

    // ARPPU = cash/payers; conversion = payers/dau — derived per day on the
    // billing daily spine, joined to dau by date. Null (not NaN/Infinity) when a
    // denominator is 0 or the dau date is missing; the renderer skips nulls.
    const dauByDate = new Map(trends.dauDaily.map((d) => [d.date, d.dau]));
    const arppuConversionDaily = dailyRows.map((r) => {
      const dau = dauByDate.get(r.date);
      return {
        date: r.date,
        arppu: r.payers > 0 ? r.cash / r.payers : null,
        conversionPct: dau && dau > 0 ? r.payers / dau : null,
      };
    });

    return {
      loading:
        headline.loading ||
        daily.loading ||
        gatewayTrend.loading ||
        support.loading ||
        lifetime.loading ||
        ingameLtv.loading ||
        geo.loading ||
        acquisition.loading ||
        trends.loading,
      error: Boolean(
        headline.error ||
          daily.error ||
          gatewayTrend.error ||
          support.error ||
          lifetime.error ||
          ingameLtv.error ||
          geo.error ||
          acquisition.error ||
          trends.error,
      ),
      headline: {
        cash,
        txns,
        payers,
        cashDelta: p0 ? pctDelta(cash, toNum(p0[M.cash])) : null,
        txnsDelta: p0 ? pctDelta(txns, toNum(p0[M.txn])) : null,
        payersDelta: p0 ? pctDelta(payers, toNum(p0[M.payers])) : null,
      },
      daily: dailyRows,
      spendDaily: trends.spendDaily,
      dauDaily: trends.dauDaily,
      csDaily: trends.csDaily,
      arppuConversionDaily,
      payerTiers: trends.payerTiers,
      heatmap: trends.heatmap,
      queries: {
        daily: q.daily,
        gatewayTrend: q.gatewayTrend,
        spend: trends.queries.spend,
        dau: trends.queries.dau,
        cs: trends.queries.cs,
        payerTiers: trends.queries.payerTiers,
        heatmap: trends.queries.heatmap,
      },
      gatewayDays,
      gatewayDates,
      gateways,
      gatewayMix,
      support: {
        tickets: toNum(s0['cs_ticket_detail.total_tickets']),
        csat: toNum(s0['cs_ticket_detail.avg_csat']),
        negative: toNum(s0['cs_ticket_detail.negative_sentiment_tickets']),
        unresolvedMember: toNum(s0['cs_ticket_detail.unresolved_member_tickets']),
        avgResolution: toNum(s0['cs_ticket_detail.avg_resolution_time']),
      },
      recon: {
        gatewayLifetime,
        ingameLtv: ingameLtvTotal,
        gapPct: ingameLtvTotal > 0 ? (gatewayLifetime - ingameLtvTotal) / ingameLtvTotal : null,
      },
      geo: {
        movers,
        base,
        moverLtv,
        moverPct: movers + base > 0 ? movers / (movers + base) : null,
      },
      acquisition: {
        spend,
        cpc: toNum(a0['marketing_cost.cpc_vnd']),
        cpm: toNum(a0['marketing_cost.cpm_vnd']),
        clicks: toNum(a0['marketing_cost.clicks']),
        revenue,
        blendedRoas: spend > 0 ? revenue / spend : null,
      },
    };
  }, [
    q.daily, q.gatewayTrend,
    headline.rows, headline.loading, headline.error, prior.rows,
    daily.rows, daily.loading, daily.error,
    gatewayTrend.rows, gatewayTrend.loading, gatewayTrend.error,
    support.rows, support.loading, support.error,
    lifetime.rows, lifetime.loading, lifetime.error,
    ingameLtv.rows, ingameLtv.loading, ingameLtv.error,
    geo.rows, geo.loading, geo.error,
    acquisition.rows, acquisition.loading, acquisition.error,
    trends,
  ]);
}
