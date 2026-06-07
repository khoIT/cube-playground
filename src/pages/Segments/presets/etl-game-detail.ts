/**
 * Curated preset for `etl_game_detail` — CFM match-event hub cube.
 *
 * Mixed-grain by design: the segment's COHORT is user-level (identity is
 * inherited cross-cube as `mf_users.user_id` via the Cube join path), while
 * the hub cube itself is match-event grain. Overview/Engagement read the
 * event grain (matches, modes, maps, intensity); Monetization/Retention
 * reuse the user-master measures (`mf_users.*`) verbatim — those queries
 * join back through the same proven path and stay fan-out-safe because
 * `mf_users.user_count` is a distinct count over the identity.
 *
 * Card ids MUST stay in sync with the server mirror
 * (`server/src/presets/etl-game-detail.ts`) — the refresh job pre-renders
 * card rows keyed `card:<tabId>:<cardId>` / `kpi:<tabId>:<id>` and the FE
 * hydrates by those exact keys.
 */

import type { Preset } from './types';

export const etlGameDetailPreset: Preset = {
  id: 'etl_game_detail-hub',
  label: 'Game detail hub',
  hubCube: 'etl_game_detail',
  // Cross-cube identity: the event table's playerid is a ROLE id; the user
  // identity lives on the joined user-master cube.
  identityDim: 'mf_users.user_id',
  reachableCubes: ['etl_game_detail', 'mf_users'],

  headlineKpis: [
    { id: 'players', label: 'Players',   measure: 'mf_users.user_count',        format: 'compact' },
    { id: 'matches', label: 'Matches',   measure: 'etl_game_detail.matches',    format: 'compact' },
    { id: 'kdr',     label: 'KDR',       measure: 'etl_game_detail.kdr',        format: 'number' },
    { id: 'ltv',     label: 'LTV total', measure: 'mf_users.ltv_total_vnd',     format: 'currency' },
  ],

  memberColumns: [
    { id: 'ltv',         label: 'LTV',         measure:   'mf_users.ltv_total_vnd',     format: 'currency' },
    // The behavior cube enforces a bounded dteventtime window — fetched in a
    // separate 30d-bound query so the mf_users columns survive regardless.
    { id: 'matches',     label: 'Matches (30d)', measure: 'etl_game_detail.matches',    format: 'compact',
      boundTimeDimension: 'etl_game_detail.dteventtime', dateRange: 'last 30 days' },
    { id: 'stage',       label: 'Stage',       dimension: 'mf_users.lifecycle_stage' },
    { id: 'last-active', label: 'Last active', dimension: 'mf_users.last_active_date' },
  ],

  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      kpis: [],
      cards: [
        { kind: 'segmented-bar', id: 'mode-strip',    label: 'Game mode',    measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.game_mode_label', limit: 6 },
        { kind: 'segmented-bar', id: 'result-strip',  label: 'Match result', measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.game_result',     limit: 5 },
        { kind: 'bar',           id: 'top-maps',      label: 'Top maps',     measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.map_label',       limit: 10, format: 'compact' },
        { kind: 'donut',         id: 'game-type',     label: 'Game type',    measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.game_type_label', limit: 5 },
        { kind: 'line',          id: 'matches-30d',   label: 'Matches (last 30 days)', measure: 'etl_game_detail.matches', timeDimension: 'etl_game_detail.dteventtime', dateRange: 'last 30 days', granularity: 'day', format: 'compact' },
        { kind: 'composition',   id: 'team-vs-solo',  label: 'Team vs solo', measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.is_team',         limit: 4 },
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
        { kind: 'line',          id: 'players-30d',   label: 'Active players (last 30 days)', measure: 'etl_game_detail.distinct_players', timeDimension: 'etl_game_detail.dteventtime', dateRange: 'last 30 days', granularity: 'day', format: 'compact' },
        { kind: 'bar',           id: 'ladder-seasons',label: 'Matches by ladder season',      measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.ladder_season',   limit: 8, format: 'compact' },
        { kind: 'segmented-bar', id: 'newbie-strip',  label: 'Newbie share',                  measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.is_newbie',       limit: 4 },
        { kind: 'segmented-bar', id: 'drop-strip',    label: 'Dropped matches',               measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.drop_match_flag', limit: 4 },
        { kind: 'donut',         id: 'network',       label: 'Network quality',               measure: 'etl_game_detail.matches', groupBy: 'etl_game_detail.network_quality', limit: 5 },
      ],
    },
    // Monetization + Retention mirror the mf_users hub tabs: same measures,
    // same card ids — but every query is scoped by THIS segment's predicate
    // (etl_game_detail filters), so the numbers describe the players behind
    // these matches.
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
