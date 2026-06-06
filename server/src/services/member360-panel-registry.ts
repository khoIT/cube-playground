/**
 * Server-local copy of the member-360 CORE panel registry.
 *
 * The canonical registry lives in the FE
 * (`src/pages/Segments/member360/member360-panels.ts`) but cannot be imported
 * here: `server/tsconfig.json` pins `rootDir: "src"` and the FE module
 * transitively pulls FE-only deps. This file duplicates the `section: 'core'`
 * panels verbatim (behavior panels stay live-on-expand and are never
 * precomputed), with FE-only types inlined.
 *
 * Drift guard: `test/member360-panel-registry-parity.test.ts` deep-compares
 * this copy against the FE registry's core subset — any divergence fails CI.
 */

export type Member360PanelType = 'profile' | 'dailyTimeline' | 'detailTable' | 'eventStream';
export type IdentityKey = 'user_id' | 'playerid' | 'clientsdkuserid';
/** FE FormatId equivalent — opaque here; only carried for registry parity. */
export type PanelFormatId = string;

export interface PanelColumn {
  member: string; // '<view>.<field>'
  label: string;
  kind: 'dimension' | 'measure';
  format?: PanelFormatId;
  pii?: boolean;
}

export interface PanelKpi {
  member: string;
  label: string;
  format?: PanelFormatId;
}

export interface Member360Panel {
  id: string;
  title: string;
  view: string;
  identityKey: IdentityKey;
  panelType: Member360PanelType;
  section: 'core' | 'behavior';
  columns: PanelColumn[];
  timeDimension?: string;
  kpis?: PanelKpi[];
  needsDateRange?: boolean;
  lazy?: boolean;
  pii?: boolean;
  limit?: number;
}

const col = (
  view: string,
  field: string,
  label: string,
  kind: 'dimension' | 'measure' = 'dimension',
  format?: PanelFormatId,
  pii?: boolean,
): PanelColumn => ({ member: `${view}.${field}`, label, kind, format, pii });

// --- CFM core panels (verbatim copy of the FE registry's core subset) -------
const CFM_CORE_PANELS: Member360Panel[] = [
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
      // Section-layout fields — the cached profile row must cover the FE's
      // member360-sections.ts profileMembers union (see FE registry comment).
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
];

// --- BALLISTAR core panels ---------------------------------------------------
const BALLISTAR_CORE_PANELS: Member360Panel[] = [
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

const CORE_PANELS_BY_GAME: Record<string, Member360Panel[]> = {
  cfm: CFM_CORE_PANELS,
  cfm_vn: CFM_CORE_PANELS,
  ballistar: BALLISTAR_CORE_PANELS,
  ballistar_vn: BALLISTAR_CORE_PANELS,
};

/** Core (eager) panels for a game, or `[]` when the game has no 360 config. */
export function corePanelsForGame(gameId: string | null | undefined): Member360Panel[] {
  if (!gameId) return [];
  return CORE_PANELS_BY_GAME[gameId] ?? [];
}
