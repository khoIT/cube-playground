/**
 * Server-side mirror of src/pages/Segments/presets/mf-users-hub.ts.
 * Card-runner uses these specs to compose Cube queries on refresh and
 * write rendered rows to segment_card_cache.
 *
 * Keep in sync with the FE file manually. v1.5 will externalize both
 * to a YAML registry consumed by both sides.
 */

export type FormatId = 'number' | 'percent' | 'currency' | 'duration' | 'compact';

export interface KpiSpec {
  id: string;
  label: string;
  measure: string;
  timeDimension?: string;
  dateRange?: string;
  format?: FormatId;
}

export interface LineCardSpec {
  kind: 'line';
  id: string;
  label: string;
  measure: string;
  timeDimension: string;
  granularity?: 'day' | 'week' | 'month';
  dateRange?: string;
  format?: FormatId;
}

export interface BarListCardSpec {
  kind: 'bar';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
  format?: FormatId;
}

export interface CompositionCardSpec {
  kind: 'composition';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
}

export type CardSpec = LineCardSpec | BarListCardSpec | CompositionCardSpec;

export interface TabDef {
  id: string;
  label: string;
  kpis: KpiSpec[];
  cards: CardSpec[];
}

export interface PresetSpec {
  id: string;
  hubCube: string;
  identityDim: string;
  /** Per-user LTV measure (logical name) used to rank members into
   *  top/middle/bottom tiers at refresh time. Absent → no tiered sampling for
   *  segments on this preset; the FE falls back to the random sample. */
  ltvMeasure?: string;
  headlineKpis: KpiSpec[];
  tabs: TabDef[];
  /** Per-member enrichment columns (Members tab + the ranked member-profile
   *  snapshot served by the tokenless pull API). Entries carry `dimension`
   *  or `measure`; columns a game's /meta doesn't have are dropped at
   *  refresh time. */
  memberColumns?: Array<Record<string, unknown>>;
}

export const mfUsersHubPreset: PresetSpec = {
  id: 'mf_users-hub',
  hubCube: 'mf_users',
  identityDim: 'mf_users.user_id',
  // Grouped by user_id, ltv_total_vnd aggregates to that one user's lifetime
  // value — the ranking key for member tiers.
  ltvMeasure: 'mf_users.ltv_total_vnd',

  // Mirrors the FE preset's memberColumns — feeds the ranked member-profile
  // snapshot (uid / name / ltv / stage / last_active / joined). The in-game
  // name dim exists only where the game models it (jus today); the /meta
  // check drops absent columns per game.
  memberColumns: [
    { id: 'name',        label: 'In-game name', dimension: 'mf_users.ingame_name' },
    { id: 'ltv',         label: 'LTV',          measure: 'mf_users.ltv_total_vnd', format: 'currency' },
    { id: 'stage',       label: 'Stage',        dimension: 'mf_users.lifecycle_stage' },
    { id: 'last-active', label: 'Last active',  dimension: 'mf_users.last_active_date' },
    { id: 'joined',      label: 'Joined',       dimension: 'mf_users.install_date' },
  ],

  headlineKpis: [
    { id: 'size',   label: 'Size',         measure: 'mf_users.user_count',    format: 'compact' },
    { id: 'paying', label: 'Paying users', measure: 'mf_users.paying_users',  format: 'compact' },
    { id: 'ltv',    label: 'LTV total',    measure: 'mf_users.ltv_total_vnd', format: 'currency' },
    { id: 'arpu',   label: 'ARPU',         measure: 'mf_users.arpu_vnd',      format: 'currency' },
  ],

  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      kpis: [],
      cards: [
        { kind: 'composition', id: 'media-comp',    label: 'Media source',    measure: 'mf_users.user_count', groupBy: 'mf_users.media_source',     limit: 6 },
        { kind: 'composition', id: 'platform-comp', label: 'OS platform',     measure: 'mf_users.user_count', groupBy: 'mf_users.os_platform',      limit: 6 },
        { kind: 'composition', id: 'country-comp',  label: 'Country',         measure: 'mf_users.user_count', groupBy: 'mf_users.country',          limit: 6 },
        { kind: 'composition', id: 'lifecycle-comp',label: 'Lifecycle stage', measure: 'mf_users.user_count', groupBy: 'mf_users.lifecycle_stage',  limit: 6 },
        { kind: 'line', id: 'installs-90d',  label: 'Installs (last 90 days)', measure: 'mf_users.user_count', timeDimension: 'mf_users.install_date', dateRange: 'last 90 days', granularity: 'day' },
        { kind: 'bar',  id: 'top-campaigns', label: 'Top campaigns',           measure: 'mf_users.user_count', groupBy: 'mf_users.campaign_id', limit: 8 },
      ],
    },
    {
      id: 'engagement',
      label: 'Engagement',
      kpis: [
        { id: 'paying-30d', label: 'Paying users (30d)', measure: 'mf_users.paying_users_30d',        format: 'compact' },
        { id: 'rate-30d',   label: 'Paying rate (30d)',  measure: 'mf_users.paying_rate_30d',         format: 'percent' },
        { id: 'lapsed',     label: 'Lapsed this month',  measure: 'mf_users.lapsed_this_month_count', format: 'compact' },
      ],
      cards: [
        { kind: 'composition', id: 'lifecycle-eng',    label: 'Lifecycle stage',                measure: 'mf_users.user_count', groupBy: 'mf_users.lifecycle_stage', limit: 6 },
        { kind: 'bar',         id: 'last-country',     label: 'Users by last-login country',    measure: 'mf_users.user_count', groupBy: 'mf_users.last_login_country', limit: 8 },
        { kind: 'line',        id: 'first-active-90d', label: 'First-active (last 90 days)',    measure: 'mf_users.user_count', timeDimension: 'mf_users.first_active_date', dateRange: 'last 90 days', granularity: 'day' },
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
        { kind: 'composition', id: 'payer-tier-comp', label: 'Payer tier',                    measure: 'mf_users.user_count',    groupBy: 'mf_users.payer_tier', limit: 6 },
        { kind: 'bar',         id: 'rev-by-media',    label: 'LTV by media source',           measure: 'mf_users.ltv_total_vnd', groupBy: 'mf_users.media_source', limit: 6 },
        { kind: 'line',        id: 'first-rev-90d',   label: 'First-recharge (last 90 days)', measure: 'mf_users.user_count',    timeDimension: 'mf_users.first_recharge_date', dateRange: 'last 90 days', granularity: 'day' },
        { kind: 'bar',         id: 'rev-by-platform', label: 'LTV by OS platform',            measure: 'mf_users.ltv_total_vnd', groupBy: 'mf_users.os_platform', limit: 5 },
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
        { kind: 'bar',         id: 'rate-by-platform', label: 'Paying rate by OS platform',  measure: 'mf_users.paying_rate', groupBy: 'mf_users.os_platform', limit: 5 },
        { kind: 'bar',         id: 'rate-by-media',    label: 'Paying rate by media source', measure: 'mf_users.paying_rate', groupBy: 'mf_users.media_source', limit: 6 },
        { kind: 'line',        id: 'installs-30d-ret', label: 'Installs (last 30 days)',     measure: 'mf_users.user_count',  timeDimension: 'mf_users.install_date', dateRange: 'last 30 days', granularity: 'day' },
      ],
    },
  ],
};

// Preset lookup moved to ./registry.ts so it can register every curated
// preset (this hub + etl-game-detail + future ones) without import cycles.
