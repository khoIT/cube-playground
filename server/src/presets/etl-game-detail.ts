/**
 * Server-side mirror of src/pages/Segments/presets/etl-game-detail.ts.
 * Card-runner uses these specs to compose Cube queries on refresh and
 * write rendered rows to segment_card_cache.
 *
 * Card/KPI ids MUST match the FE file exactly — the FE hydrates by
 * `kpi:<id>` / `kpi:<tabId>:<id>` / `card:<tabId>:<cardId>` keys. The FE's
 * presentation-only kinds (segmented-bar, donut) are declared here as
 * `composition` — the query shape (measure + groupBy + limit) is identical,
 * only the FE rendering differs.
 *
 * Mixed grain: Overview/Engagement are match-event measures; Monetization/
 * Retention reuse `mf_users.*` cross-cube — Cube joins back through the same
 * path that gives these segments their inherited `mf_users.user_id` identity.
 */

import type { PresetSpec } from './mf-users-hub.js';

export const etlGameDetailPreset: PresetSpec = {
  id: 'etl_game_detail-hub',
  hubCube: 'etl_game_detail',
  identityDim: 'mf_users.user_id',
  // Cross-cube like the Monetization tab: tier ranking joins back through the
  // same path that gives these segments their inherited mf_users identity.
  ltvMeasure: 'mf_users.ltv_total_vnd',

  headlineKpis: [
    { id: 'players', label: 'Players',   measure: 'mf_users.user_count',     format: 'compact' },
    { id: 'matches', label: 'Matches',   measure: 'etl_game_detail.matches', format: 'compact' },
    { id: 'kdr',     label: 'KDR',       measure: 'etl_game_detail.kdr',     format: 'number' },
    { id: 'ltv',     label: 'LTV total', measure: 'mf_users.ltv_total_vnd',  format: 'currency' },
  ],

  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      kpis: [],
      cards: [
        { kind: 'composition', id: 'mode-strip',   label: 'Game mode',    measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.game_mode_label', limit: 6 },
        { kind: 'composition', id: 'result-strip', label: 'Match result', measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.game_result',     limit: 5 },
        { kind: 'bar',         id: 'top-maps',     label: 'Top maps',     measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.map_label',       limit: 10, format: 'compact' },
        { kind: 'composition', id: 'game-type',    label: 'Game type',    measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.game_type_label', limit: 5 },
        { kind: 'line',        id: 'matches-30d',  label: 'Matches (last 30 days)', measure: 'etl_game_detail.matches', timeDimension: 'etl_game_detail.dteventtime', dateRange: 'last 30 days', granularity: 'day', format: 'compact' },
        { kind: 'composition', id: 'team-vs-solo', label: 'Team vs solo', measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.is_team',         limit: 4 },
      ],
    },
    {
      id: 'engagement',
      label: 'Engagement',
      kpis: [
        { id: 'kast',     label: 'Avg KAST',      measure: 'etl_game_detail.avg_kast',      format: 'percent' },
        { id: 'accuracy', label: 'Accuracy',      measure: 'etl_game_detail.accuracy',      format: 'percent' },
        { id: 'headshot', label: 'Headshot rate', measure: 'etl_game_detail.headshot_rate', format: 'percent' },
      ],
      cards: [
        { kind: 'line',        id: 'players-30d',    label: 'Active players (last 30 days)', measure: 'etl_game_detail.distinct_players', timeDimension: 'etl_game_detail.dteventtime', dateRange: 'last 30 days', granularity: 'day', format: 'compact' },
        { kind: 'bar',         id: 'ladder-seasons', label: 'Matches by ladder season',      measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.ladder_season',   limit: 8, format: 'compact' },
        { kind: 'composition', id: 'newbie-strip',   label: 'Newbie share',                  measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.is_newbie',       limit: 4 },
        { kind: 'composition', id: 'drop-strip',     label: 'Dropped matches',               measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.drop_match_flag', limit: 4 },
        { kind: 'composition', id: 'network',        label: 'Network quality',               measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.network_quality', limit: 5 },
      ],
    },
    {
      id: 'monetization',
      label: 'Monetization',
      kpis: [
        { id: 'ltv-total', label: 'LTV total', measure: 'mf_users.ltv_total_vnd',     format: 'currency' },
        { id: 'ltv-30d',   label: 'LTV 30d',   measure: 'mf_users.ltv_30d_total_vnd', format: 'currency' },
        { id: 'arppu',     label: 'ARPPU',     measure: 'mf_users.arppu_vnd',         format: 'currency' },
        { id: 'whales',    label: 'Whales',    measure: 'mf_users.whales_count',      format: 'compact' },
      ],
      cards: [
        { kind: 'composition', id: 'payer-tier-comp', label: 'Payer tier',                    measure: 'mf_users.user_count',    groupBy: 'mf_users.payer_tier',   limit: 6 },
        { kind: 'bar',         id: 'rev-by-media',    label: 'LTV by media source',           measure: 'mf_users.ltv_total_vnd', groupBy: 'mf_users.media_source', limit: 6, format: 'currency' },
        { kind: 'line',        id: 'first-rev-90d',   label: 'First-recharge (last 90 days)', measure: 'mf_users.user_count',    timeDimension: 'mf_users.first_recharge_date', dateRange: 'last 90 days', granularity: 'day', format: 'compact' },
        { kind: 'bar',         id: 'rev-by-platform', label: 'LTV by OS platform',            measure: 'mf_users.ltv_total_vnd', groupBy: 'mf_users.os_platform',  limit: 5, format: 'currency' },
      ],
    },
    {
      id: 'retention',
      label: 'Retention',
      kpis: [
        { id: 'paying-30d-r', label: 'Paying users (30d)', measure: 'mf_users.paying_users_30d',        format: 'compact' },
        { id: 'rate-30d-r',   label: 'Paying rate (30d)',  measure: 'mf_users.paying_rate_30d',         format: 'percent' },
        { id: 'lapsed-r',     label: 'Lapsed this month',  measure: 'mf_users.lapsed_this_month_count', format: 'compact' },
      ],
      cards: [
        { kind: 'composition', id: 'lifecycle-ret',    label: 'Lifecycle stage',             measure: 'mf_users.user_count',  groupBy: 'mf_users.lifecycle_stage', limit: 6 },
        { kind: 'bar',         id: 'rate-by-platform', label: 'Paying rate by OS platform',  measure: 'mf_users.paying_rate', groupBy: 'mf_users.os_platform',     limit: 5, format: 'percent' },
        { kind: 'bar',         id: 'rate-by-media',    label: 'Paying rate by media source', measure: 'mf_users.paying_rate', groupBy: 'mf_users.media_source',    limit: 6, format: 'percent' },
        { kind: 'line',        id: 'installs-30d-ret', label: 'Installs (last 30 days)',     measure: 'mf_users.user_count',  timeDimension: 'mf_users.install_date', dateRange: 'last 30 days', granularity: 'day', format: 'compact' },
      ],
    },
  ],
};
