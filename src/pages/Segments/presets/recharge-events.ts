/**
 * recharge-events preset bundle.
 *
 * Recharge is an event cube (one row per transaction), so all per-user
 * member-columns are aggregates (measures) rather than flat dimensions.
 * Time-series cards key off `recharge_date`.
 *
 * Available recharge fields (from /cubejs-api/v1/meta):
 *   measures   — transactions, revenue_vnd, paying_users, paying_users_exact,
 *                arppu_vnd, arpt_vnd
 *   dimensions — transaction_id, user_id, account_id, role_id, role_name,
 *                recharge_time, recharge_date, log_month, payment_channel,
 *                money_type, product_id, server_id, country_code, os_platform,
 *                value_vnd, ingame_value, is_first_recharge, txn_value_band_vnd
 */

import type { Preset } from './types';

export const rechargeEventsPreset: Preset = {
  id: 'recharge-events',
  label: 'Recharge events hub',
  hubCube: 'recharge',
  identityDim: 'recharge.user_id',
  reachableCubes: ['recharge'],

  headlineKpis: [
    { id: 'paying',  label: 'Paying users', measure: 'recharge.paying_users', format: 'compact' },
    { id: 'revenue', label: 'Revenue',      measure: 'recharge.revenue_vnd',  format: 'currency' },
    { id: 'arppu',   label: 'ARPPU',        measure: 'recharge.arppu_vnd',    format: 'currency' },
    { id: 'txns',    label: 'Transactions', measure: 'recharge.transactions', format: 'compact' },
  ],

  memberColumns: [
    { id: 'revenue',  label: 'Revenue',     measure: 'recharge.revenue_vnd',  format: 'currency' },
    { id: 'txns',     label: 'Txn count',   measure: 'recharge.transactions', format: 'compact'  },
    { id: 'account',  label: 'Account ID',  dimension: 'recharge.account_id'  },
    { id: 'country',  label: 'Country',     dimension: 'recharge.country_code' },
  ],

  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      gridCols: 2,
      kpis: [],
      cards: [
        { kind: 'composition', id: 'channel-comp',   label: 'Payment channel',   measure: 'recharge.transactions', groupBy: 'recharge.payment_channel',   limit: 6 },
        { kind: 'composition', id: 'country-comp',   label: 'Country',           measure: 'recharge.transactions', groupBy: 'recharge.country_code',      limit: 6 },
        { kind: 'composition', id: 'platform-comp',  label: 'OS platform',       measure: 'recharge.transactions', groupBy: 'recharge.os_platform',       limit: 6 },
        { kind: 'composition', id: 'band-comp',      label: 'Txn value band',    measure: 'recharge.transactions', groupBy: 'recharge.txn_value_band_vnd', limit: 6 },
        { kind: 'line',        id: 'rev-90d',        label: 'Revenue (last 90 days)', measure: 'recharge.revenue_vnd',  timeDimension: 'recharge.recharge_date', dateRange: 'last 90 days', granularity: 'day', format: 'currency' },
        { kind: 'bar',         id: 'top-products',   label: 'Top products',      measure: 'recharge.revenue_vnd',  groupBy: 'recharge.product_id', limit: 8, format: 'currency' },
      ],
    },
    {
      id: 'engagement',
      label: 'Engagement',
      gridCols: 2,
      kpis: [
        { id: 'paying-eng', label: 'Paying users',       measure: 'recharge.paying_users',       format: 'compact'  },
        { id: 'txns-eng',   label: 'Transactions',       measure: 'recharge.transactions',       format: 'compact'  },
        { id: 'arpt-eng',   label: 'Avg per transaction', measure: 'recharge.arpt_vnd',          format: 'currency' },
      ],
      cards: [
        { kind: 'line',        id: 'txn-trend-90d',  label: 'Transactions (last 90 days)', measure: 'recharge.transactions', timeDimension: 'recharge.recharge_date', dateRange: 'last 90 days', granularity: 'day', format: 'compact' },
        { kind: 'composition', id: 'band-eng',       label: 'Txn value band',              measure: 'recharge.transactions', groupBy: 'recharge.txn_value_band_vnd', limit: 6 },
        { kind: 'bar',         id: 'txns-by-country', label: 'Transactions by country',   measure: 'recharge.transactions', groupBy: 'recharge.country_code', limit: 8, format: 'compact' },
        { kind: 'bar',         id: 'txns-by-os',     label: 'Transactions by OS',         measure: 'recharge.transactions', groupBy: 'recharge.os_platform', limit: 5, format: 'compact' },
      ],
    },
    {
      id: 'monetization',
      label: 'Monetization',
      gridCols: 2,
      kpis: [
        { id: 'revenue-mon', label: 'Revenue', measure: 'recharge.revenue_vnd', format: 'currency' },
        { id: 'arppu-mon',   label: 'ARPPU',   measure: 'recharge.arppu_vnd',   format: 'currency' },
        { id: 'arpt-mon',    label: 'ARPT',    measure: 'recharge.arpt_vnd',    format: 'currency' },
      ],
      cards: [
        { kind: 'line',        id: 'rev-trend-90d',     label: 'Revenue (last 90 days)',    measure: 'recharge.revenue_vnd',  timeDimension: 'recharge.recharge_date', dateRange: 'last 90 days', granularity: 'day', format: 'currency' },
        { kind: 'bar',         id: 'rev-by-channel',    label: 'Revenue by channel',        measure: 'recharge.revenue_vnd',  groupBy: 'recharge.payment_channel', limit: 6, format: 'currency' },
        { kind: 'bar',         id: 'rev-by-platform',   label: 'Revenue by OS platform',    measure: 'recharge.revenue_vnd',  groupBy: 'recharge.os_platform',     limit: 5, format: 'currency' },
        { kind: 'composition', id: 'band-mon',          label: 'Txn value band (revenue)',  measure: 'recharge.revenue_vnd',  groupBy: 'recharge.txn_value_band_vnd', limit: 6 },
      ],
    },
    {
      id: 'retention',
      label: 'Retention',
      gridCols: 2,
      kpis: [
        { id: 'paying-ret', label: 'Paying users',  measure: 'recharge.paying_users', format: 'compact'  },
        { id: 'txns-ret',   label: 'Transactions',  measure: 'recharge.transactions', format: 'compact'  },
      ],
      cards: [
        { kind: 'line',        id: 'paying-trend-90d', label: 'Paying users (last 90 days)', measure: 'recharge.paying_users', timeDimension: 'recharge.recharge_date', dateRange: 'last 90 days', granularity: 'day', format: 'compact' },
        { kind: 'bar',         id: 'rev-by-month',     label: 'Revenue by month',            measure: 'recharge.revenue_vnd',  groupBy: 'recharge.log_month',           limit: 12, format: 'currency' },
        { kind: 'bar',         id: 'txns-by-channel-ret', label: 'Transactions by channel', measure: 'recharge.transactions', groupBy: 'recharge.payment_channel',     limit: 6,  format: 'compact'  },
        { kind: 'composition', id: 'first-vs-repeat',  label: 'First vs repeat',             measure: 'recharge.transactions', groupBy: 'recharge.is_first_recharge',   limit: 2 },
      ],
    },
  ],
};
