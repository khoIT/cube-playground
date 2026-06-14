/**
 * Per-member 360 panel registry — declarative config the page maps to ~4
 * generic renderers. Each game points at its own `user_360.yml` view family, so
 * adding a game (cros/tf) is a config entry, not new components.
 *
 * Members are pre-classified dimension-vs-measure (Cube rejects a measure in
 * `dimensions:`), curated to a high-signal subset, and view-qualified
 * (`<view>.<member>`). The page builds one query per panel via the renderers.
 *
 * Identity keys differ per view: profile/roles/devices/ips/timelines join
 * `user_id`; login/logout sessions key `clientsdkuserid` (= user_id, direct);
 * the FPS event panels key `playerid`, reached through the role bridge
 * (`user_roles_panel.role_id` for the user → `playerid IN role_ids`).
 *
 * Behavior panels sit over `etl_*` cubes (1M–1.3B rows) guarded by cube.js to a
 * ≤31-day window — they are `lazy` + `needsDateRange`, queried only on expand
 * with a bounded `dteventtime` filter.
 */

import type { FormatId } from '../presets/types';

export type Member360PanelType = 'profile' | 'dailyTimeline' | 'detailTable' | 'eventStream';
export type IdentityKey = 'user_id' | 'playerid' | 'clientsdkuserid' | 'role_id';

/** A column rendered in a 360 panel (dimension or measure, view-qualified). */
export interface PanelColumn {
  member: string; // '<view>.<field>'
  label: string;
  kind: 'dimension' | 'measure';
  format?: FormatId;
  pii?: boolean;
}

/** A headline stat for the profile KPI strip. */
export interface PanelKpi {
  member: string;
  label: string;
  format?: FormatId;
}

export interface Member360Panel {
  id: string;
  title: string;
  /** Cube view (logical, bare). */
  view: string;
  identityKey: IdentityKey;
  panelType: Member360PanelType;
  section: 'core' | 'behavior';
  columns: PanelColumn[];
  /** Time dimension member (timelines + event streams). */
  timeDimension?: string;
  /** KPI cards rendered above a profile panel. */
  kpis?: PanelKpi[];
  /** Behavior panels: lazy-load + require a bounded date filter. */
  needsDateRange?: boolean;
  lazy?: boolean;
  /** Devices / IPs panels carry PII. */
  pii?: boolean;
  /** Default row cap for table / timeline panels. */
  limit?: number;
}

const col = (
  view: string,
  field: string,
  label: string,
  kind: 'dimension' | 'measure' = 'dimension',
  format?: FormatId,
  pii?: boolean,
): PanelColumn => ({ member: `${view}.${field}`, label, kind, format, pii });

// ---------------------------------------------------------------------------
// CFM — full 360: profile + roles/devices/ips + daily/monthly + FPS behavior.
// ---------------------------------------------------------------------------
const CFM_PANELS: Member360Panel[] = [
  {
    id: 'profile',
    title: 'Profile',
    view: 'user_profile',
    identityKey: 'user_id',
    panelType: 'profile',
    section: 'core',
    kpis: [
      { member: 'user_profile.ltv_vnd', label: 'Lifetime value', format: 'currency' },
      { member: 'user_profile.total_active_days', label: 'Active days', format: 'number' },
      { member: 'user_profile.lifetime_txn_count', label: 'Transactions', format: 'number' },
      { member: 'user_profile.max_role_level', label: 'Max level', format: 'number' },
      { member: 'user_profile.max_vip_level', label: 'Max VIP', format: 'number' },
      { member: 'user_profile.days_since_last_active', label: 'Days since active', format: 'number' },
    ],
    columns: [
      col('user_profile', 'user_id', 'User ID'),
      col('user_profile', 'country', 'Country'),
      col('user_profile', 'os_platform', 'Platform'),
      col('user_profile', 'payer_tier', 'Payer tier'),
      col('user_profile', 'lifecycle_stage', 'Lifecycle'),
      col('user_profile', 'engagement_segment', 'Engagement'),
      col('user_profile', 'last_role_class', 'Last class'),
      col('user_profile', 'last_server_id', 'Last server'),
      col('user_profile', 'media_source', 'Acquired via'),
      col('user_profile', 'ltv_vnd', 'LTV (VND)', 'dimension', 'currency'),
      col('user_profile', 'ltv_30d_vnd', 'LTV 30d', 'dimension', 'currency'),
      col('user_profile', 'install_date', 'Installed'),
      col('user_profile', 'first_recharge_date', 'First recharge'),
      col('user_profile', 'last_active_date', 'Last active'),
      col('user_profile', 'last_login_date', 'Last login'),
      // The remaining fields the 360 dashboard's section layout reads
      // (member360-sections.ts profileMembers union). They ride in this panel
      // so the nightly precompute caches ONE profile row that covers the whole
      // top of the page — the cache-first path checks coverage at runtime and
      // falls back to live when any required member is missing.
      col('user_profile', 'is_paying_user', 'Paying user'),
      col('user_profile', 'ltv_iap_vnd', 'LTV — IAP', 'dimension', 'currency'),
      col('user_profile', 'ltv_web_vnd', 'LTV — Web', 'dimension', 'currency'),
      col('user_profile', 'txn_count_30d', 'Txns 30d', 'dimension', 'number'),
      col('user_profile', 'last_recharge_date', 'Last recharge'),
      col('user_profile', 'first_device_model', 'Device model'),
      col('user_profile', 'last_login_country', 'Last login country'),
      col('user_profile', 'days_since_install', 'Days since install', 'dimension', 'number'),
      col('user_profile', 'install_month', 'Install month'),
      col('user_profile', 'is_paid_install', 'Paid install'),
      col('user_profile', 'first_login_date', 'First login'),
      col('user_profile', 'first_login_channel', 'First login channel'),
      col('user_profile', 'first_active_date', 'First active'),
    ],
  },
  {
    id: 'roles',
    title: 'Characters / roles',
    view: 'user_roles_panel',
    identityKey: 'user_id',
    panelType: 'detailTable',
    section: 'core',
    limit: 100,
    columns: [
      col('user_roles_panel', 'role_id', 'Role ID'),
      col('user_roles_panel', 'last_role_name', 'Name'),
      col('user_roles_panel', 'last_role_class', 'Class'),
      col('user_roles_panel', 'server_id', 'Server'),
      col('user_roles_panel', 'max_role_level', 'Max level', 'dimension', 'number'),
      col('user_roles_panel', 'max_vip_level', 'Max VIP', 'dimension', 'number'),
      col('user_roles_panel', 'role_ltv_vnd', 'Role LTV (VND)', 'dimension', 'currency'),
      col('user_roles_panel', 'total_active_days', 'Active days', 'dimension', 'number'),
      col('user_roles_panel', 'last_active_date', 'Last active'),
    ],
  },
  {
    id: 'devices',
    title: 'Devices',
    view: 'user_devices_panel',
    identityKey: 'user_id',
    panelType: 'detailTable',
    section: 'core',
    pii: true,
    limit: 50,
    columns: [
      col('user_devices_panel', 'device_id', 'Device ID', 'dimension', undefined, true),
      col('user_devices_panel', 'first_active_date', 'First seen'),
      col('user_devices_panel', 'last_active_date', 'Last seen'),
      col('user_devices_panel', 'rows', 'Active days', 'measure', 'number'),
    ],
  },
  {
    id: 'ips',
    title: 'IP addresses',
    view: 'user_ips_panel',
    identityKey: 'user_id',
    panelType: 'detailTable',
    section: 'core',
    pii: true,
    limit: 50,
    columns: [
      col('user_ips_panel', 'client_ip', 'IP address', 'dimension', undefined, true),
      col('user_ips_panel', 'first_active_date', 'First seen'),
      col('user_ips_panel', 'last_active_date', 'Last seen'),
      col('user_ips_panel', 'rows', 'Active days', 'measure', 'number'),
    ],
  },
  {
    id: 'activity_timeline',
    title: 'Activity (daily)',
    view: 'user_activity_timeline',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_activity_timeline.log_date',
    limit: 90,
    columns: [
      col('user_activity_timeline', 'server_id', 'Server'),
      col('user_activity_timeline', 'role_class', 'Class'),
      col('user_activity_timeline', 'online_time_sec', 'Online', 'dimension', 'duration'),
      col('user_activity_timeline', 'max_role_level', 'Level', 'dimension', 'number'),
      col('user_activity_timeline', 'is_recharge_day', 'Paid?'),
    ],
  },
  {
    id: 'recharge_timeline',
    title: 'Recharge (daily)',
    view: 'user_recharge_timeline',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_recharge_timeline.log_date',
    limit: 90,
    columns: [
      col('user_recharge_timeline', 'payment_channel', 'Channel'),
      col('user_recharge_timeline', 'product_id', 'Product'),
      col('user_recharge_timeline', 'revenue_vnd', 'Revenue (VND)', 'dimension', 'currency'),
      col('user_recharge_timeline', 'txn_count', 'Txns', 'dimension', 'number'),
      col('user_recharge_timeline', 'vip_level', 'VIP', 'dimension', 'number'),
    ],
  },
  {
    id: 'activity_monthly',
    title: 'Activity (monthly)',
    view: 'user_activity_monthly',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_activity_monthly.log_month',
    limit: 24,
    columns: [
      col('user_activity_monthly', 'active_days', 'Active days', 'dimension', 'number'),
      col('user_activity_monthly', 'recharge_days', 'Recharge days', 'dimension', 'number'),
      col('user_activity_monthly', 'total_online_time_sec', 'Online', 'dimension', 'duration'),
      col('user_activity_monthly', 'max_role_level', 'Max level', 'dimension', 'number'),
      col('user_activity_monthly', 'last_country_code', 'Country'),
    ],
  },
  {
    id: 'revenue_monthly',
    title: 'Revenue (monthly)',
    view: 'user_revenue_monthly',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_revenue_monthly.log_month',
    limit: 24,
    columns: [
      col('user_revenue_monthly', 'revenue_vnd', 'Revenue (VND)', 'dimension', 'currency'),
      col('user_revenue_monthly', 'revenue_usd', 'Revenue (USD)', 'dimension', 'number'),
      col('user_revenue_monthly', 'txn_count', 'Txns', 'dimension', 'number'),
      col('user_revenue_monthly', 'max_vip_level', 'Max VIP', 'dimension', 'number'),
      col('user_revenue_monthly', 'last_payment_channel', 'Channel'),
    ],
  },
  // --- Behavior (lazy, ≤31d bounded) --------------------------------------
  behaviorPanel('login', 'Logins', 'user_login_panel', 'clientsdkuserid', [
    ['hour_of_day_vn', 'Hour'],
    ['weekday_label', 'Weekday'],
    ['network', 'Network'],
    ['client_version', 'Version'],
    ['ladder_score', 'Ladder'],
    ['country', 'Country'],
  ]),
  behaviorPanel('logout', 'Logouts', 'user_logout_panel', 'clientsdkuserid', [
    ['online_time_sec', 'Session', 'duration'],
    ['logout_type', 'Type'],
    ['network', 'Network'],
    ['server_id', 'Server'],
  ]),
  behaviorPanel('matches', 'Matchmaking', 'user_matches_panel', 'playerid', [
    ['game_mode', 'Mode'],
    ['map_id', 'Map'],
    ['result', 'Result'],
    ['kd_ratio', 'K/D'],
    ['score', 'Score'],
  ]),
  behaviorPanel('game_detail', 'Match detail', 'user_game_detail_panel', 'playerid', [
    ['game_mode_label', 'Mode'],
    ['map_label', 'Map'],
    ['game_result', 'Result'],
    ['ladder_level', 'Ladder'],
    ['level', 'Level'],
  ]),
  behaviorPanel('money_flow', 'Currency flow', 'user_money_flow_panel', 'playerid', [
    ['money_type', 'Currency'],
    ['direction', 'Dir'],
    ['delta', 'Delta'],
    ['reason_base_label', 'Reason'],
  ]),
  behaviorPanel('lottery', 'Gacha pulls', 'user_lottery_panel', 'playerid', [
    ['lottery_box', 'Box'],
    ['is_ten_pull', '10-pull?'],
    ['cost_diamond', 'Diamonds'],
    ['result', 'Result'],
  ]),
  behaviorPanel('prop_flow', 'Item flow', 'user_prop_flow_panel', 'playerid', [
    ['prop_type', 'Type'],
    ['direction', 'Dir'],
    ['prop_num', 'Qty'],
    ['reason', 'Reason'],
  ]),
  behaviorPanel('tutorial', 'Tutorial', 'user_tutorial_panel', 'playerid', [
    ['tutorial_id', 'Step'],
    ['tutorial_status', 'Status'],
    ['is_completed', 'Done?'],
  ]),
  behaviorPanel('team_starts', 'Team starts', 'user_team_starts_panel', 'playerid', [
    ['game_mode', 'Mode'],
    ['team_member_count', 'Team size'],
    ['result', 'Result'],
  ]),
  behaviorPanel('newbie_detail', 'Onboarding detail', 'user_newbie_detail_panel', 'playerid', [
    ['self_esteem_label', 'Self-esteem'],
    ['score', 'Score'],
  ]),
];

/** Build a lazy, ≤31d-bounded FPS event-stream panel. */
function behaviorPanel(
  id: string,
  title: string,
  view: string,
  identityKey: IdentityKey,
  fields: Array<[string, string, FormatId?]>,
): Member360Panel {
  return {
    id,
    title,
    view,
    identityKey,
    panelType: 'eventStream',
    section: 'behavior',
    needsDateRange: true,
    lazy: true,
    limit: 100,
    timeDimension: `${view}.dteventtime`,
    columns: [
      col(view, 'dteventtime', 'When'),
      ...fields.map(([f, label, fmt]) => col(view, f, label, 'dimension', fmt)),
    ],
  };
}

// ---------------------------------------------------------------------------
// BALLISTAR — core 360 only (its user_360.yml has no event/role/device panels).
// Makes the feature reachable today: every existing segment is ballistar.
// ---------------------------------------------------------------------------
const BALLISTAR_PANELS: Member360Panel[] = [
  {
    id: 'profile',
    title: 'Profile',
    view: 'user_profile',
    identityKey: 'user_id',
    panelType: 'profile',
    section: 'core',
    kpis: [
      { member: 'user_profile.ltv_vnd', label: 'Lifetime value', format: 'currency' },
      { member: 'user_profile.total_active_days', label: 'Active days', format: 'number' },
      { member: 'user_profile.lifetime_txn_count', label: 'Transactions', format: 'number' },
      { member: 'user_profile.max_role_level', label: 'Max level', format: 'number' },
      { member: 'user_profile.max_vip_level', label: 'Max VIP', format: 'number' },
      { member: 'user_profile.days_since_last_active', label: 'Days since active', format: 'number' },
    ],
    columns: [
      col('user_profile', 'user_id', 'User ID'),
      col('user_profile', 'country', 'Country'),
      col('user_profile', 'os_platform', 'Platform'),
      col('user_profile', 'payer_tier', 'Payer tier'),
      col('user_profile', 'lifecycle_stage', 'Lifecycle'),
      col('user_profile', 'last_role_class', 'Last class'),
      col('user_profile', 'last_server_id', 'Last server'),
      col('user_profile', 'media_source', 'Acquired via'),
      col('user_profile', 'ltv_vnd', 'LTV (VND)', 'dimension', 'currency'),
      col('user_profile', 'install_date', 'Installed'),
      col('user_profile', 'first_recharge_date', 'First recharge'),
      col('user_profile', 'last_active_date', 'Last active'),
      // Section-layout fields (see the CFM profile panel note): cached profile
      // row must cover member360-sections.ts profileMembers for ballistar too.
      col('user_profile', 'ltv_30d_vnd', 'LTV 30d', 'dimension', 'currency'),
      col('user_profile', 'last_login_date', 'Last login'),
      col('user_profile', 'is_paying_user', 'Paying user'),
      col('user_profile', 'ltv_iap_vnd', 'LTV — IAP', 'dimension', 'currency'),
      col('user_profile', 'ltv_web_vnd', 'LTV — Web', 'dimension', 'currency'),
      col('user_profile', 'txn_count_30d', 'Txns 30d', 'dimension', 'number'),
      col('user_profile', 'last_recharge_date', 'Last recharge'),
      col('user_profile', 'first_device_model', 'Device model'),
      col('user_profile', 'last_login_country', 'Last login country'),
      col('user_profile', 'days_since_install', 'Days since install', 'dimension', 'number'),
      col('user_profile', 'install_month', 'Install month'),
      col('user_profile', 'is_paid_install', 'Paid install'),
      col('user_profile', 'first_login_date', 'First login'),
      col('user_profile', 'first_login_channel', 'First login channel'),
      col('user_profile', 'first_active_date', 'First active'),
    ],
  },
  {
    id: 'activity_timeline',
    title: 'Activity (daily)',
    view: 'user_activity_timeline',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_activity_timeline.log_date',
    limit: 90,
    columns: [
      col('user_activity_timeline', 'server_id', 'Server'),
      col('user_activity_timeline', 'role_class', 'Class'),
      col('user_activity_timeline', 'online_time_sec', 'Online', 'dimension', 'duration'),
      col('user_activity_timeline', 'max_role_level', 'Level', 'dimension', 'number'),
      col('user_activity_timeline', 'is_recharge_day', 'Paid?'),
    ],
  },
  {
    id: 'recharge_timeline',
    title: 'Recharge (daily)',
    view: 'user_recharge_timeline',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_recharge_timeline.log_date',
    limit: 90,
    columns: [
      col('user_recharge_timeline', 'payment_channel', 'Channel'),
      col('user_recharge_timeline', 'product_id', 'Product'),
      col('user_recharge_timeline', 'revenue_vnd', 'Revenue (VND)', 'dimension', 'currency'),
      col('user_recharge_timeline', 'txn_count', 'Txns', 'dimension', 'number'),
      col('user_recharge_timeline', 'vip_level', 'VIP', 'dimension', 'number'),
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions',
    view: 'user_transactions',
    identityKey: 'user_id',
    panelType: 'detailTable',
    section: 'core',
    timeDimension: 'user_transactions.recharge_date',
    limit: 50,
    columns: [
      col('user_transactions', 'recharge_date', 'Date'),
      col('user_transactions', 'product_id', 'Product'),
      col('user_transactions', 'payment_channel', 'Channel'),
      col('user_transactions', 'value_vnd', 'Value (VND)', 'dimension', 'currency'),
      col('user_transactions', 'txn_value_band_vnd', 'Band'),
    ],
  },
];

/** Build a lazy, ≤31d-bounded session event panel (login/logout/register) over a
 *  std session view that bounds on `log_date`. cros keys these by user_id (etl
 *  joins to mf_users directly); tf keys by role_id (resolved via the role bridge,
 *  like cfm's playerid panels). */
function sessionPanel(
  id: string,
  title: string,
  view: string,
  identityKey: IdentityKey,
  fields: Array<[string, string, FormatId?]>,
): Member360Panel {
  return {
    id,
    title,
    view,
    identityKey,
    panelType: 'eventStream',
    section: 'behavior',
    needsDateRange: true,
    lazy: true,
    limit: 100,
    timeDimension: `${view}.log_date`,
    columns: [
      col(view, 'log_date', 'Date'),
      ...fields.map(([f, label, fmt]) => col(view, f, label, 'dimension', fmt)),
    ],
  };
}

// ---------------------------------------------------------------------------
// CROS / TF — full 360. Both expose the rich view family (profile + roles +
// device/IP rollups + daily/monthly + sessions). cros/tf user_profile carry
// engagement_segment (like cfm). The device/IP views are per-user AGGREGATE
// rollups (distinct counts + first/last seen) — NOT per-row device_id/client_ip
// lists like cfm's, so no raw PII column is exposed here.
//
// Core panels (section: 'core') are mirrored verbatim in the server registry
// (member360-panel-registry.ts) — keep the two in sync (parity test guards it).
// ---------------------------------------------------------------------------

/** Profile panel shared by cros + tf (cfm-shape, with engagement_segment). */
function richProfilePanel(): Member360Panel {
  return {
    id: 'profile',
    title: 'Profile',
    view: 'user_profile',
    identityKey: 'user_id',
    panelType: 'profile',
    section: 'core',
    kpis: [
      { member: 'user_profile.ltv_vnd', label: 'Lifetime value', format: 'currency' },
      { member: 'user_profile.total_active_days', label: 'Active days', format: 'number' },
      { member: 'user_profile.lifetime_txn_count', label: 'Transactions', format: 'number' },
      { member: 'user_profile.max_role_level', label: 'Max level', format: 'number' },
      { member: 'user_profile.max_vip_level', label: 'Max VIP', format: 'number' },
      { member: 'user_profile.days_since_last_active', label: 'Days since active', format: 'number' },
    ],
    columns: [
      col('user_profile', 'user_id', 'User ID'),
      col('user_profile', 'country', 'Country'),
      col('user_profile', 'os_platform', 'Platform'),
      col('user_profile', 'payer_tier', 'Payer tier'),
      col('user_profile', 'lifecycle_stage', 'Lifecycle'),
      col('user_profile', 'engagement_segment', 'Engagement'),
      col('user_profile', 'last_role_class', 'Last class'),
      col('user_profile', 'last_server_id', 'Last server'),
      col('user_profile', 'media_source', 'Acquired via'),
      col('user_profile', 'ltv_vnd', 'LTV (VND)', 'dimension', 'currency'),
      col('user_profile', 'ltv_30d_vnd', 'LTV 30d', 'dimension', 'currency'),
      col('user_profile', 'install_date', 'Installed'),
      col('user_profile', 'first_recharge_date', 'First recharge'),
      col('user_profile', 'last_active_date', 'Last active'),
      col('user_profile', 'last_login_date', 'Last login'),
      col('user_profile', 'is_paying_user', 'Paying user'),
      col('user_profile', 'ltv_iap_vnd', 'LTV — IAP', 'dimension', 'currency'),
      col('user_profile', 'ltv_web_vnd', 'LTV — Web', 'dimension', 'currency'),
      col('user_profile', 'txn_count_30d', 'Txns 30d', 'dimension', 'number'),
      col('user_profile', 'last_recharge_date', 'Last recharge'),
      col('user_profile', 'first_device_model', 'Device model'),
      col('user_profile', 'last_login_country', 'Last login country'),
      col('user_profile', 'days_since_install', 'Days since install', 'dimension', 'number'),
      col('user_profile', 'install_month', 'Install month'),
      col('user_profile', 'is_paid_install', 'Paid install'),
      col('user_profile', 'first_login_date', 'First login'),
      col('user_profile', 'first_login_channel', 'First login channel'),
      col('user_profile', 'first_active_date', 'First active'),
    ],
  };
}

/** Characters/roles panel shared by cros + tf. */
function rolesPanel(): Member360Panel {
  return {
    id: 'roles',
    title: 'Characters / roles',
    view: 'user_roles_panel',
    identityKey: 'user_id',
    panelType: 'detailTable',
    section: 'core',
    limit: 100,
    columns: [
      col('user_roles_panel', 'role_id', 'Role ID'),
      col('user_roles_panel', 'last_role_name', 'Name'),
      col('user_roles_panel', 'last_role_class', 'Class'),
      col('user_roles_panel', 'server_id', 'Server'),
      col('user_roles_panel', 'max_role_level', 'Max level', 'dimension', 'number'),
      col('user_roles_panel', 'max_vip_level', 'Max VIP', 'dimension', 'number'),
      col('user_roles_panel', 'role_ltv_vnd', 'Role LTV (VND)', 'dimension', 'currency'),
      col('user_roles_panel', 'total_active_days', 'Active days', 'dimension', 'number'),
      col('user_roles_panel', 'last_active_date', 'Last active'),
    ],
  };
}

/** Aggregate device-count panel. cros/tf user_devices is per-(user, device)
 *  grain, so the panel selects measures only (filtered to one user → a single
 *  rolled-up row): distinct device count + record count. No raw device_id
 *  column exists in this rollup view (no per-device PII exposed). */
function deviceRollupPanel(): Member360Panel {
  return {
    id: 'devices',
    title: 'Devices',
    view: 'user_devices_panel',
    identityKey: 'user_id',
    panelType: 'detailTable',
    section: 'core',
    limit: 1,
    columns: [
      col('user_devices_panel', 'distinct_devices', 'Distinct devices', 'measure', 'number'),
      col('user_devices_panel', 'rows', 'Records', 'measure', 'number'),
    ],
  };
}

/** Aggregate IP-count panel. cros/tf user_ips is per-(user, ip) grain → measures
 *  only (one rolled-up row per user). No raw client_ip column in this rollup. */
function ipRollupPanel(): Member360Panel {
  return {
    id: 'ips',
    title: 'IP addresses',
    view: 'user_ips_panel',
    identityKey: 'user_id',
    panelType: 'detailTable',
    section: 'core',
    limit: 1,
    columns: [
      col('user_ips_panel', 'distinct_ips', 'Distinct IPs', 'measure', 'number'),
      col('user_ips_panel', 'rows', 'Records', 'measure', 'number'),
    ],
  };
}

/** Daily activity timeline shared by cros + tf. */
function activityTimelinePanel(): Member360Panel {
  return {
    id: 'activity_timeline',
    title: 'Activity (daily)',
    view: 'user_activity_timeline',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_activity_timeline.log_date',
    limit: 90,
    columns: [
      col('user_activity_timeline', 'server_id', 'Server'),
      col('user_activity_timeline', 'role_class', 'Class'),
      col('user_activity_timeline', 'online_time_sec', 'Online', 'dimension', 'duration'),
      col('user_activity_timeline', 'max_role_level', 'Level', 'dimension', 'number'),
      col('user_activity_timeline', 'is_recharge_day', 'Paid?'),
    ],
  };
}

/** Daily recharge timeline shared by cros + tf. */
function rechargeTimelinePanel(): Member360Panel {
  return {
    id: 'recharge_timeline',
    title: 'Recharge (daily)',
    view: 'user_recharge_timeline',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_recharge_timeline.log_date',
    limit: 90,
    columns: [
      col('user_recharge_timeline', 'payment_channel', 'Channel'),
      col('user_recharge_timeline', 'product_id', 'Product'),
      col('user_recharge_timeline', 'revenue_vnd', 'Revenue (VND)', 'dimension', 'currency'),
      col('user_recharge_timeline', 'txn_count', 'Txns', 'dimension', 'number'),
      col('user_recharge_timeline', 'vip_level', 'VIP', 'dimension', 'number'),
    ],
  };
}

/** Monthly activity rollup shared by cros + tf. */
function activityMonthlyPanel(): Member360Panel {
  return {
    id: 'activity_monthly',
    title: 'Activity (monthly)',
    view: 'user_activity_monthly',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_activity_monthly.log_month',
    limit: 24,
    columns: [
      col('user_activity_monthly', 'active_days', 'Active days', 'dimension', 'number'),
      col('user_activity_monthly', 'recharge_days', 'Recharge days', 'dimension', 'number'),
      col('user_activity_monthly', 'total_online_time_sec', 'Online', 'dimension', 'duration'),
      col('user_activity_monthly', 'max_role_level', 'Max level', 'dimension', 'number'),
      col('user_activity_monthly', 'last_country_code', 'Country'),
    ],
  };
}

/** Monthly revenue rollup shared by cros + tf. */
function revenueMonthlyPanel(): Member360Panel {
  return {
    id: 'revenue_monthly',
    title: 'Revenue (monthly)',
    view: 'user_revenue_monthly',
    identityKey: 'user_id',
    panelType: 'dailyTimeline',
    section: 'core',
    timeDimension: 'user_revenue_monthly.log_month',
    limit: 24,
    columns: [
      col('user_revenue_monthly', 'revenue_vnd', 'Revenue (VND)', 'dimension', 'currency'),
      col('user_revenue_monthly', 'revenue_usd', 'Revenue (USD)', 'dimension', 'number'),
      col('user_revenue_monthly', 'txn_count', 'Txns', 'dimension', 'number'),
      col('user_revenue_monthly', 'max_vip_level', 'Max VIP', 'dimension', 'number'),
      col('user_revenue_monthly', 'last_payment_channel', 'Channel'),
    ],
  };
}

const CROS_PANELS: Member360Panel[] = [
  richProfilePanel(),
  rolesPanel(),
  deviceRollupPanel(),
  ipRollupPanel(),
  activityTimelinePanel(),
  rechargeTimelinePanel(),
  {
    // cros raw transactions use payment_platform / recharged_value / txn_value_band
    // (multi-region naming) rather than ballistar's payment_channel / value_vnd.
    id: 'transactions',
    title: 'Transactions',
    view: 'user_transactions',
    identityKey: 'user_id',
    panelType: 'detailTable',
    section: 'core',
    timeDimension: 'user_transactions.recharge_date',
    limit: 50,
    columns: [
      col('user_transactions', 'recharge_date', 'Date'),
      col('user_transactions', 'product_id', 'Product'),
      col('user_transactions', 'payment_platform', 'Channel'),
      col('user_transactions', 'recharged_value', 'Value', 'dimension', 'currency'),
      col('user_transactions', 'txn_value_band', 'Band'),
    ],
  },
  activityMonthlyPanel(),
  revenueMonthlyPanel(),
  // --- Sessions (lazy, ≤31d bounded, user_id-keyed — etl joins mf_users) ----
  sessionPanel('login', 'Logins', 'user_login_panel', 'user_id', [
    ['hour_of_day_vn', 'Hour'],
    ['day_of_week_vn', 'Weekday'],
    ['login_channel', 'Channel'],
    ['os_platform', 'Platform'],
    ['server_id', 'Server'],
    ['country_code', 'Country'],
  ]),
  sessionPanel('logout', 'Logouts', 'user_logout_panel', 'user_id', [
    ['online_time_sec', 'Session', 'duration'],
    ['session_band', 'Band'],
    ['login_channel', 'Channel'],
    ['server_id', 'Server'],
    ['country_code', 'Country'],
  ]),
  sessionPanel('register', 'Registrations', 'user_register_panel', 'user_id', [
    ['login_channel', 'Channel'],
    ['os_platform', 'Platform'],
    ['server_id', 'Server'],
    ['country_code', 'Country'],
  ]),
];

const TF_PANELS: Member360Panel[] = [
  richProfilePanel(),
  rolesPanel(),
  deviceRollupPanel(),
  ipRollupPanel(),
  activityTimelinePanel(),
  rechargeTimelinePanel(),
  activityMonthlyPanel(),
  revenueMonthlyPanel(),
  // tf raw transactions are role_id-keyed (TGA events via the role bridge) and
  // redundant with the VND-normalized recharge_timeline — deferred. Sessions are
  // role_id-keyed: the event-panel grid resolves the user's role_ids first.
  sessionPanel('login', 'Logins', 'user_login_panel', 'role_id', [
    ['hour_of_day_local', 'Hour'],
    ['channel', 'Channel'],
    ['os_platform', 'Platform'],
    ['server_id', 'Server'],
    ['lineup_rating', 'Lineup', 'number'],
    ['country_code', 'Country'],
  ]),
  sessionPanel('logout', 'Logouts', 'user_logout_panel', 'role_id', [
    ['online_time_sec', 'Session', 'duration'],
    ['session_band', 'Band'],
    ['activity_type', 'Activity'],
    ['game_type', 'Mode'],
    ['server_id', 'Server'],
  ]),
  sessionPanel('register', 'Registrations', 'user_register_panel', 'role_id', [
    ['channel', 'Channel'],
    ['os_platform', 'Platform'],
    ['server_id', 'Server'],
    ['country_code', 'Country'],
    ['is_simulator', 'Simulator?'],
  ]),
];

// Cross-cutting ops panels (cfm + jus only — these cubes exist for those games).
// All lazy / section:'behavior' so they load on expand and are never precomputed
// (the CS + identity sources lag; billing is live but txn-grain). Behavior panels
// live only in the FE registry, so they don't touch the server core-parity copy.
function opsPanels(): Member360Panel[] {
  return [
    {
      id: 'ops_identity',
      title: 'Identity & geo',
      view: 'user_identity_panel',
      identityKey: 'user_id',
      panelType: 'detailTable',
      section: 'behavior',
      lazy: true,
      limit: 1,
      columns: [
        col('user_identity_panel', 'first_country_code', 'First country'),
        col('user_identity_panel', 'last_country_code', 'Last country'),
        col('user_identity_panel', 'geo_moved', 'Moved country?'),
        col('user_identity_panel', 'first_os', 'First OS'),
        col('user_identity_panel', 'last_os', 'Last OS'),
        col('user_identity_panel', 'first_login_channel', 'First channel'),
        col('user_identity_panel', 'last_login_channel', 'Last channel'),
        col('user_identity_panel', 'media_source', 'Acquired via'),
        col('user_identity_panel', 'user_type', 'User type'),
        col('user_identity_panel', 'days_since_last_active', 'Days since active (lagging)', 'dimension', 'number'),
      ],
    },
    {
      id: 'ops_billing_detail',
      title: 'Billing breakdown',
      view: 'user_billing_detail_panel',
      identityKey: 'user_id',
      panelType: 'dailyTimeline',
      section: 'behavior',
      lazy: true,
      needsDateRange: true,
      timeDimension: 'user_billing_detail_panel.order_date',
      limit: 90,
      columns: [
        col('user_billing_detail_panel', 'currency', 'Currency'),
        col('user_billing_detail_panel', 'payment_gateway', 'Gateway'),
        col('user_billing_detail_panel', 'store', 'Store'),
        col('user_billing_detail_panel', 'promotion_type', 'Promo'),
        col('user_billing_detail_panel', 'cash_charged_gross', 'Cash charged', 'measure', 'currency'),
        col('user_billing_detail_panel', 'promo_charged_gross', 'Promo charged', 'measure', 'currency'),
        col('user_billing_detail_panel', 'txn_count_total', 'Txns', 'measure', 'number'),
      ],
    },
    {
      id: 'ops_billing_lifetime',
      title: 'Lifetime billing',
      view: 'user_billing_lifetime_panel',
      identityKey: 'user_id',
      panelType: 'detailTable',
      section: 'behavior',
      lazy: true,
      limit: 1,
      columns: [
        col('user_billing_lifetime_panel', 'lifetime_vnd', 'Lifetime (VND)', 'dimension', 'currency'),
        col('user_billing_lifetime_panel', 'lifetime_usd', 'Lifetime (USD)', 'dimension', 'number'),
        col('user_billing_lifetime_panel', 'lifetime_txn_count', 'Txns', 'dimension', 'number'),
        col('user_billing_lifetime_panel', 'first_date', 'First order'),
        col('user_billing_lifetime_panel', 'last_date', 'Last order'),
      ],
    },
    {
      id: 'ops_cs_tickets',
      title: 'Support tickets',
      view: 'user_cs_tickets_panel',
      identityKey: 'user_id',
      panelType: 'detailTable',
      section: 'behavior',
      lazy: true,
      limit: 50,
      timeDimension: 'user_cs_tickets_panel.created_date',
      columns: [
        col('user_cs_tickets_panel', 'created_date', 'Created'),
        col('user_cs_tickets_panel', 'ticket_status', 'Status'),
        col('user_cs_tickets_panel', 'ticket_category', 'Category'),
        col('user_cs_tickets_panel', 'ticket_source', 'Source'),
        col('user_cs_tickets_panel', 'sentiment', 'Sentiment'),
        col('user_cs_tickets_panel', 'ticket_rating', 'CSAT', 'dimension', 'number'),
        col('user_cs_tickets_panel', 'vip_id', 'VIP', 'dimension', 'number'),
      ],
    },
  ];
}

const CFM_ALL_PANELS: Member360Panel[] = [...CFM_PANELS, ...opsPanels()];
const JUS_ALL_PANELS: Member360Panel[] = [...BALLISTAR_PANELS, ...opsPanels()];

const PANELS_BY_GAME: Record<string, Member360Panel[]> = {
  cfm: CFM_ALL_PANELS,
  cfm_vn: CFM_ALL_PANELS,
  ballistar: BALLISTAR_PANELS,
  ballistar_vn: BALLISTAR_PANELS,
  // jus shares the core-360 view family (user_profile / activity / recharge /
  // transactions) and adds the cross-cutting ops panels (billing / identity / CS).
  jus: JUS_ALL_PANELS,
  jus_vn: JUS_ALL_PANELS,
  // cros / tf expose the full rich view family (sessions + monthly + rollups).
  cros: CROS_PANELS,
  tf: TF_PANELS,
  // muaw / pubg model the 4 core views only (no role/device/event cubes yet) —
  // same core shape as ballistar.
  muaw: BALLISTAR_PANELS,
  pubg: BALLISTAR_PANELS,
};

/** Panels for a game, or `[]` when the game has no 360 config (page guards). */
export function panelsForGame(gameId: string | null | undefined): Member360Panel[] {
  if (!gameId) return [];
  return PANELS_BY_GAME[gameId] ?? [];
}

/** True when the member-360 page is enabled for this game. */
export function hasMember360(gameId: string | null | undefined): boolean {
  return panelsForGame(gameId).length > 0;
}
