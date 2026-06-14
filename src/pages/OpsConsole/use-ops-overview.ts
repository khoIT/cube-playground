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
import { useMemberCubeQuery } from '../Segments/member360/use-member-cube-query';
import { opsWindowRanges, pctDelta, type OpsWindow } from './ops-window';
import { toNum } from './ops-format';
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
  gatewayDays: Record<string, number>[];
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

export function useOpsOverview(gameId: string, window: OpsWindow): OpsOverviewData {
  // Daily-stable "today": rolls over at UTC midnight but is constant within a day
  // so the memoised ranges/queries don't refetch every render (a raw new Date()
  // in deps would loop).
  const todayKey = new Date().toISOString().slice(0, 10);
  const ranges = useMemo(
    () => opsWindowRanges(window, new Date(`${todayKey}T00:00:00Z`)),
    [window, todayKey],
  );

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
    const gatewayDays = [...byDay.keys()].sort().map((d) => byDay.get(d)!);
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

    return {
      loading:
        headline.loading ||
        daily.loading ||
        gatewayTrend.loading ||
        support.loading ||
        lifetime.loading ||
        ingameLtv.loading ||
        geo.loading ||
        acquisition.loading,
      error: Boolean(
        headline.error ||
          daily.error ||
          gatewayTrend.error ||
          support.error ||
          lifetime.error ||
          ingameLtv.error ||
          geo.error ||
          acquisition.error,
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
      gatewayDays,
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
    headline.rows, headline.loading, headline.error, prior.rows,
    daily.rows, daily.loading, daily.error,
    gatewayTrend.rows, gatewayTrend.loading, gatewayTrend.error,
    support.rows, support.loading, support.error,
    lifetime.rows, lifetime.loading, lifetime.error,
    ingameLtv.rows, ingameLtv.loading, ingameLtv.error,
    geo.rows, geo.loading, geo.error,
    acquisition.rows, acquisition.loading, acquisition.error,
  ]);
}
