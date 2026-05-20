/**
 * mf_users-hub preset bundle.
 *
 * Measures / dimensions match the live `mf_users` cube YAML.
 * `mf_users` is a dimensional user table (1 row per user), so all
 * time-series cards key off lifecycle dates (install / first_active /
 * first_recharge), not event dates.
 */

import type { Preset } from './types';

export const mfUsersHubPreset: Preset = {
  id: 'mf_users-hub',
  label: 'mf_users hub',
  hubCube: 'mf_users',
  identityDim: 'mf_users.user_id',
  reachableCubes: ['mf_users'],

  headlineKpis: [
    { id: 'size',     label: 'Size',          measure: 'mf_users.user_count',       format: 'compact' },
    { id: 'paying',   label: 'Paying users',  measure: 'mf_users.paying_users',     format: 'compact' },
    { id: 'ltv',      label: 'LTV total',     measure: 'mf_users.ltv_total_vnd',    format: 'currency' },
    { id: 'arpu',     label: 'ARPU',          measure: 'mf_users.arpu_vnd',         format: 'currency' },
  ],

  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      gridCols: 2,
      kpis: [],
      cards: [
        { kind: 'composition', id: 'media-comp',    label: 'Media source',      measure: 'mf_users.user_count', groupBy: 'mf_users.media_source', limit: 6 },
        { kind: 'composition', id: 'platform-comp', label: 'OS platform',       measure: 'mf_users.user_count', groupBy: 'mf_users.os_platform',  limit: 6 },
        { kind: 'composition', id: 'country-comp',  label: 'Country',           measure: 'mf_users.user_count', groupBy: 'mf_users.country',      limit: 6 },
        { kind: 'composition', id: 'lifecycle-comp',label: 'Lifecycle stage',   measure: 'mf_users.user_count', groupBy: 'mf_users.lifecycle_stage', limit: 6 },
        { kind: 'line', id: 'installs-90d', label: 'Installs (last 90 days)', measure: 'mf_users.user_count', timeDimension: 'mf_users.install_date', dateRange: 'last 90 days', granularity: 'day', format: 'compact' },
        { kind: 'bar',  id: 'top-campaigns', label: 'Top campaigns',          measure: 'mf_users.user_count', groupBy: 'mf_users.campaign_id', limit: 8, format: 'compact' },
      ],
    },
    {
      id: 'engagement',
      label: 'Engagement',
      gridCols: 2,
      kpis: [
        { id: 'paying-30d', label: 'Paying users (30d)', measure: 'mf_users.paying_users_30d',    format: 'compact' },
        { id: 'rate-30d',   label: 'Paying rate (30d)',  measure: 'mf_users.paying_rate_30d',     format: 'percent' },
        { id: 'lapsed',     label: 'Lapsed this month',  measure: 'mf_users.lapsed_this_month_count', format: 'compact' },
      ],
      cards: [
        { kind: 'composition', id: 'lifecycle-eng', label: 'Lifecycle stage', measure: 'mf_users.user_count', groupBy: 'mf_users.lifecycle_stage', limit: 6 },
        { kind: 'bar',         id: 'last-country',  label: 'Users by last-login country', measure: 'mf_users.user_count', groupBy: 'mf_users.last_login_country', limit: 8, format: 'compact' },
        { kind: 'line',        id: 'first-active-90d', label: 'First-active (last 90 days)', measure: 'mf_users.user_count', timeDimension: 'mf_users.first_active_date', dateRange: 'last 90 days', granularity: 'day', format: 'compact' },
      ],
    },
    {
      id: 'monetization',
      label: 'Monetization',
      gridCols: 2,
      kpis: [
        { id: 'ltv-total',   label: 'LTV total',    measure: 'mf_users.ltv_total_vnd',     format: 'currency' },
        { id: 'ltv-30d',     label: 'LTV 30d',      measure: 'mf_users.ltv_30d_total_vnd', format: 'currency' },
        { id: 'arppu',       label: 'ARPPU',        measure: 'mf_users.arppu_vnd',         format: 'currency' },
        { id: 'whales',      label: 'Whales',       measure: 'mf_users.whales_count',      format: 'compact' },
      ],
      cards: [
        { kind: 'composition', id: 'payer-tier-comp', label: 'Payer tier', measure: 'mf_users.user_count', groupBy: 'mf_users.payer_tier', limit: 6 },
        { kind: 'bar',         id: 'rev-by-media',    label: 'LTV by media source', measure: 'mf_users.ltv_total_vnd', groupBy: 'mf_users.media_source', limit: 6, format: 'currency' },
        { kind: 'line',        id: 'first-rev-90d',   label: 'First-recharge (last 90 days)', measure: 'mf_users.user_count', timeDimension: 'mf_users.first_recharge_date', dateRange: 'last 90 days', granularity: 'day', format: 'compact' },
        { kind: 'bar',         id: 'rev-by-platform', label: 'LTV by OS platform',  measure: 'mf_users.ltv_total_vnd', groupBy: 'mf_users.os_platform',  limit: 5, format: 'currency' },
      ],
    },
    {
      id: 'retention',
      label: 'Retention',
      gridCols: 2,
      kpis: [
        { id: 'paying-30d-r', label: 'Paying users (30d)', measure: 'mf_users.paying_users_30d',       format: 'compact' },
        { id: 'rate-30d-r',   label: 'Paying rate (30d)',  measure: 'mf_users.paying_rate_30d',        format: 'percent' },
        { id: 'lapsed-r',     label: 'Lapsed this month',  measure: 'mf_users.lapsed_this_month_count', format: 'compact' },
      ],
      cards: [
        { kind: 'composition', id: 'lifecycle-ret', label: 'Lifecycle stage', measure: 'mf_users.user_count', groupBy: 'mf_users.lifecycle_stage', limit: 6 },
        { kind: 'bar',         id: 'rate-by-platform', label: 'Paying rate by OS platform', measure: 'mf_users.paying_rate', groupBy: 'mf_users.os_platform', limit: 5, format: 'percent' },
        { kind: 'bar',         id: 'rate-by-media',    label: 'Paying rate by media source', measure: 'mf_users.paying_rate', groupBy: 'mf_users.media_source', limit: 6, format: 'percent' },
        { kind: 'line',        id: 'installs-30d-ret', label: 'Installs (last 30 days)', measure: 'mf_users.user_count', timeDimension: 'mf_users.install_date', dateRange: 'last 30 days', granularity: 'day', format: 'compact' },
      ],
    },
  ],
};
