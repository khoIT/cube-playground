/**
 * mf_users-hub preset bundle.
 *
 * NOTE: The measure / dimension names below are best-effort references against
 * the assumed `mf_users` cube. If the actual cube-dev schema uses different
 * names, replace the strings here — the rest of the rendering stays the same.
 * Missing measures render as Skeleton placeholders without crashing the tab.
 */

import type { Preset } from './types';

export const mfUsersHubPreset: Preset = {
  id: 'mf_users-hub',
  label: 'mf_users hub',
  hubCube: 'mf_users',
  identityDim: 'mf_users.user_id',
  reachableCubes: ['mf_users', 'mf_events', 'mf_payments'],

  headlineKpis: [
    { id: 'size', label: 'Size', measure: 'mf_users.count', format: 'compact' },
    { id: 'dau', label: 'DAU (today)', measure: 'mf_users.dau', dateRange: 'today', format: 'compact' },
    { id: 'rev30', label: 'Revenue 30d', measure: 'mf_users.revenue', dateRange: 'last 30 days', format: 'currency' },
    { id: 'd7', label: 'D7 retention', measure: 'mf_users.d7_retention', format: 'percent' },
  ],

  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      gridCols: 2,
      kpis: [],
      cards: [
        { kind: 'composition', id: 'channel-comp',  label: 'Acquisition channel', measure: 'mf_users.count', groupBy: 'mf_users.acquisition_channel', limit: 6 },
        { kind: 'composition', id: 'platform-comp', label: 'Platform',             measure: 'mf_users.count', groupBy: 'mf_users.platform',             limit: 6 },
        { kind: 'composition', id: 'country-comp',  label: 'Country',              measure: 'mf_users.count', groupBy: 'mf_users.country',              limit: 6 },
        { kind: 'line', id: 'dau-14d', label: 'DAU last 14 days',    measure: 'mf_users.dau',      timeDimension: 'mf_users.event_date', dateRange: 'last 14 days', granularity: 'day', format: 'compact' },
        { kind: 'line', id: 'rev-14d', label: 'Revenue last 14 days', measure: 'mf_users.revenue',  timeDimension: 'mf_users.event_date', dateRange: 'last 14 days', granularity: 'day', format: 'currency' },
        { kind: 'bar',  id: 'pay-methods', label: 'Top payment methods', measure: 'mf_users.revenue', groupBy: 'mf_users.payment_method', limit: 5, format: 'currency' },
      ],
    },
    {
      id: 'engagement',
      label: 'Engagement',
      gridCols: 2,
      kpis: [
        { id: 'dau-today',  label: 'DAU today',   measure: 'mf_users.dau',         dateRange: 'today',         format: 'compact' },
        { id: 'mau-30d',    label: 'MAU 30d',     measure: 'mf_users.mau',         dateRange: 'last 30 days',  format: 'compact' },
        { id: 'stickiness', label: 'Stickiness',  measure: 'mf_users.stickiness',                              format: 'percent' },
      ],
      cards: [
        { kind: 'line', id: 'dau-14d-eng', label: 'DAU last 14 days', measure: 'mf_users.dau', timeDimension: 'mf_users.event_date', dateRange: 'last 14 days', granularity: 'day', format: 'compact' },
        { kind: 'bar',  id: 'sessions',     label: 'Sessions per user', measure: 'mf_users.session_count', groupBy: 'mf_users.session_bucket', limit: 8 },
      ],
    },
    {
      id: 'monetization',
      label: 'Monetization',
      gridCols: 2,
      kpis: [
        { id: 'rev30',      label: 'Revenue 30d',     measure: 'mf_users.revenue', dateRange: 'last 30 days', format: 'currency' },
        { id: 'arpu',       label: 'ARPU lifetime',   measure: 'mf_users.arpu',                              format: 'currency' },
        { id: 'arppu',      label: 'ARPPU',           measure: 'mf_users.arppu',                             format: 'currency' },
        { id: 'pay-rate',   label: 'Paying rate',     measure: 'mf_users.paying_rate',                       format: 'percent' },
      ],
      cards: [
        { kind: 'line', id: 'rev-14d-m',     label: 'Revenue last 14 days', measure: 'mf_users.revenue',     timeDimension: 'mf_users.event_date', dateRange: 'last 14 days', granularity: 'day', format: 'currency' },
        { kind: 'bar',  id: 'pay-methods-m', label: 'Top payment methods',  measure: 'mf_users.revenue',     groupBy: 'mf_users.payment_method', limit: 5, format: 'currency' },
      ],
    },
    {
      id: 'retention',
      label: 'Retention',
      gridCols: 2,
      kpis: [
        { id: 'd7',  label: 'D7 retention',  measure: 'mf_users.d7_retention',  format: 'percent' },
        { id: 'd30', label: 'D30 retention', measure: 'mf_users.d30_retention', format: 'percent' },
        { id: 'tenure', label: 'Median tenure (days)', measure: 'mf_users.median_tenure_days', format: 'number' },
      ],
      cards: [
        { kind: 'line', id: 'retention-curve', label: 'Retention curve', measure: 'mf_users.retention', timeDimension: 'mf_users.day_offset', dateRange: 'last 30 days', granularity: 'day', format: 'percent' },
        { kind: 'bar',  id: 'first-active',     label: 'First-active cohort buckets', measure: 'mf_users.count', groupBy: 'mf_users.first_active_bucket', limit: 8 },
      ],
    },
  ],
};
