/**
 * Cube query builders for the Ops Console Overview — pure functions so Phase 6
 * can statically assert the contracts:
 *  - aggregate-only: NO user_id filter / PII dimension on any query → no PII.
 *  - A1 distinct: the headline (paying_users) query carries NO day granularity
 *    (count_distinct_approx is non-additive — never summed across days).
 *  - A2 currency: jus billing_detail is mixed USD+VND → jus money queries filter
 *    currency='VND'. cfm is VND-only (no filter).
 *  - billing scans are bounded by the window dateRange (≤31d) — no unbounded scan.
 *
 * Money uses billing_detail.cash_charged_gross / recharge.revenue_vnd_real —
 * NEVER recharge.revenue_vnd (~9× inflated ingame units).
 */
import type { Query, Filter } from '@cubejs-client/core';
import type { OpsRange } from './ops-window';

/** Games whose billing_detail mixes USD + VND rows (money needs a VND filter). */
function vndFilter(gameId: string): Filter[] {
  return gameId === 'jus_vn'
    ? [{ member: 'billing_detail.currency', operator: 'equals', values: ['VND'] }]
    : [];
}

const range = (r: OpsRange) => [r.start, r.end] as [string, string];

/** Headline: cash + transactions + paying_users over the whole window, NO day
 *  granularity (A1 — paying_users is non-additive). */
export function billingHeadlineQuery(gameId: string, r: OpsRange): Query {
  return {
    measures: [
      'billing_detail.cash_charged_gross',
      'billing_detail.txn_count_total',
      'billing_detail.paying_users',
    ],
    timeDimensions: [{ dimension: 'billing_detail.order_date', dateRange: range(r) }],
    filters: vndFilter(gameId),
  };
}

/** Daily trend: cash + txn + payers per day (payers per-day is a valid distinct;
 *  the SERIES is display-only — never summed to a total). */
export function billingDailyTrendQuery(gameId: string, r: OpsRange): Query {
  return {
    measures: [
      'billing_detail.cash_charged_gross',
      'billing_detail.txn_count_total',
      'billing_detail.paying_users',
    ],
    timeDimensions: [
      { dimension: 'billing_detail.order_date', dateRange: range(r), granularity: 'day' },
    ],
    filters: vndFilter(gameId),
    order: { 'billing_detail.order_date': 'asc' },
  };
}

/** Gateway mix over time (stacked): cash per gateway per day. Mix totals are
 *  derived client-side by summing each gateway's days (cash is additive). */
export function gatewayTrendQuery(gameId: string, r: OpsRange): Query {
  return {
    measures: ['billing_detail.cash_charged_gross'],
    dimensions: ['billing_detail.payment_gateway'],
    timeDimensions: [
      { dimension: 'billing_detail.order_date', dateRange: range(r), granularity: 'day' },
    ],
    filters: vndFilter(gameId),
    order: { 'billing_detail.order_date': 'asc' },
  };
}

/** Support health — status-independent measures only (closed/open are broken,
 *  A6). created_date bounds the window. ~2d warehouse lag (tag in the UI). */
export function supportQuery(r: OpsRange): Query {
  return {
    measures: [
      'cs_ticket_detail.total_tickets',
      'cs_ticket_detail.avg_csat',
      'cs_ticket_detail.negative_sentiment_tickets',
      'cs_ticket_detail.unresolved_member_tickets',
      'cs_ticket_detail.avg_resolution_time',
    ],
    timeDimensions: [{ dimension: 'cs_ticket_detail.created_date', dateRange: range(r) }],
  };
}

/** Lifetime gateway total (snapshot — no date dim, no window/Δ). */
export function lifetimeQuery(): Query {
  return { measures: ['billing_lifetime.lifetime_vnd_total', 'billing_lifetime.payers'] };
}

/** Ingame-delivered LTV total from mf_users (snapshot — the other side of the
 *  reconciliation wedge). */
export function ingameLtvQuery(): Query {
  return { measures: ['mf_users.ltv_total_vnd', 'mf_users.user_count'] };
}

/** Cross-border signal: movers vs base by geo_moved (first≠last login country —
 *  travel/VPN/sharing proxy). count + LTV only, no "Nx richer" framing. */
export function geoQuery(): Query {
  return {
    measures: ['mf_users.user_count', 'mf_users.ltv_total_vnd'],
    dimensions: ['mf_users.geo_moved'],
  };
}

/** Acquisition spend over the window (cost + CPC + CPM + clicks). The blended-ROAS
 *  numerator is the window's VND cash (billing_detail.cash_charged_gross from the
 *  headline) — NOT a recharge measure: cfm's revenue_vnd_real reconciles to
 *  gateway cash and jus has no trustworthy recharge-revenue measure
 *  (recharge.revenue_vnd is banned, ~9× inflated). */
export function acquisitionQuery(r: OpsRange): Query {
  return {
    measures: [
      'marketing_cost.cost_vnd',
      'marketing_cost.cpc_vnd',
      'marketing_cost.cpm_vnd',
      'marketing_cost.clicks',
    ],
    timeDimensions: [{ dimension: 'marketing_cost.log_date', dateRange: range(r) }],
  };
}
