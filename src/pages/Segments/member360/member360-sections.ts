/**
 * Dashboard section config for the per-member 360 — mirrors the cfm-user360
 * reference layout (hero + monetization + profile/acquisition + journey) on
 * cube-playground's design tokens. All fields are flat `mf_users` dimensions
 * surfaced through the `user_profile` view, so the whole top of the page is one
 * query (the field union below). Per game so ballistar (no engagement_segment)
 * stays correct.
 */

import type { FormatId } from '../presets/types';

const VIEW = 'user_profile';

export interface FieldRef {
  /** bare mf_users field; qualified to `user_profile.<field>` at query time */
  field: string;
  label: string;
  icon?: string;
  format?: FormatId;
}

/** A derived hero chip: `flag` → show flagLabel when truthy; `value` → show the value. */
export interface BadgeRef {
  field: string;
  icon: string;
  kind: 'value' | 'flag';
  flagLabel?: string;
}

/** One colored segment of the LTV-split ratio bar (share of `primary`). */
export interface SplitSegmentRef {
  field: string;
  label: string;
  /** Token-backed segment color. */
  tone: 'brand' | 'info';
}

export interface Member360Sections {
  /** 4 headline pills in the hero. */
  pills: FieldRef[];
  badges: BadgeRef[];
  /** `country · os` style location chip (joined, omitted if both blank). */
  locationFields?: [string, string];
  /** Monetization band: one dominant stat + inline secondaries + ratio bar. */
  monetization: {
    primary: FieldRef;
    stats: FieldRef[];
    /** Segments of primary's total; remainder renders as "Other". */
    split?: SplitSegmentRef[];
  };
  /** Profile & status: subtitled KV clusters + a categorical chips row. */
  profileGroups: { title: string; fields: FieldRef[] }[];
  statusChips: FieldRef[];
  /** Acquisition: ordered horizontal timeline steps + categorical chips. */
  acquisitionTimeline: FieldRef[];
  acquisitionChips: FieldRef[];
  /** Journey milestone dots (date fields, left→right). */
  milestones: FieldRef[];
  /** Member for the level-progression line + daily-recharge bar (≤31d). */
  levelMember: string;
  levelTimeDimension: string;
  rechargeMember: string;
  rechargeTimeDimension: string;
}

export const qualify = (field: string): string => `${VIEW}.${field}`;

const CFM_SECTIONS: Member360Sections = {
  pills: [
    { field: 'ltv_vnd', label: 'LTV', format: 'currency' },
    { field: 'max_role_level', label: 'Max level', format: 'number' },
    { field: 'total_active_days', label: 'Active days', format: 'number' },
    { field: 'last_active_date', label: 'Last active', format: 'date-relative' },
  ],
  badges: [
    { field: 'payer_tier', icon: '🏆', kind: 'value' },
    { field: 'lifecycle_stage', icon: '⏱️', kind: 'value' },
    { field: 'engagement_segment', icon: '🔥', kind: 'value' },
    { field: 'is_paying_user', icon: '💳', kind: 'flag', flagLabel: 'Paying' },
  ],
  locationFields: ['country', 'os_platform'],
  // Paying flag lives in the hero badges; IAP/Web totals feed the split bar.
  monetization: {
    primary: { field: 'ltv_vnd', label: 'Lifetime LTV', icon: '💎', format: 'currency' },
    stats: [
      { field: 'ltv_30d_vnd', label: 'LTV 30d', icon: '📈', format: 'currency' },
      { field: 'lifetime_txn_count', label: 'Lifetime txns', icon: '🧾', format: 'number' },
      { field: 'txn_count_30d', label: 'Txns 30d', icon: '🎟️', format: 'number' },
      { field: 'first_recharge_date', label: 'First recharge', icon: '🥇', format: 'date-relative' },
      { field: 'last_recharge_date', label: 'Last recharge', icon: '🕐', format: 'date-relative' },
    ],
    split: [
      { field: 'ltv_iap_vnd', label: 'IAP', tone: 'brand' },
      { field: 'ltv_web_vnd', label: 'Web', tone: 'info' },
    ],
  },
  profileGroups: [
    {
      title: 'Identity',
      fields: [
        { field: 'country', label: 'Country', icon: '🌍' },
        { field: 'os_platform', label: 'OS platform', icon: '📱' },
        { field: 'first_device_model', label: 'Device model', icon: '📲' },
        { field: 'last_server_id', label: 'Last server', icon: '🖥️' },
        { field: 'last_login_country', label: 'Last login country', icon: '🌐' },
      ],
    },
    {
      title: 'Progression & health',
      fields: [
        { field: 'max_role_level', label: 'Max level', icon: '⭐', format: 'number' },
        { field: 'max_vip_level', label: 'Max VIP', icon: '👑', format: 'number' },
        { field: 'days_since_install', label: 'Tenure', icon: '🗓️', format: 'tenure' },
        { field: 'days_since_last_active', label: 'Days since active', icon: '😴', format: 'number' },
      ],
    },
  ],
  statusChips: [
    { field: 'engagement_segment', label: 'Engagement', icon: '🔥' },
    { field: 'lifecycle_stage', label: 'Lifecycle', icon: '⏱️' },
  ],
  acquisitionTimeline: [
    { field: 'install_date', label: 'Install', icon: '📅', format: 'date-relative' },
    { field: 'first_login_date', label: 'First login', icon: '🔑', format: 'date-relative' },
    { field: 'last_login_date', label: 'Last login', icon: '🔄', format: 'date-relative' },
  ],
  acquisitionChips: [
    { field: 'media_source', label: 'Media source', icon: '📣' },
    { field: 'first_login_channel', label: 'Channel', icon: '📕' },
    { field: 'is_paid_install', label: 'Install', icon: '💰' },
  ],
  milestones: [
    { field: 'install_date', label: 'Install' },
    { field: 'first_login_date', label: 'First login' },
    { field: 'first_active_date', label: 'First active' },
    { field: 'first_recharge_date', label: 'First recharge' },
    { field: 'last_recharge_date', label: 'Last recharge' },
    { field: 'last_active_date', label: 'Last active' },
  ],
  levelMember: 'user_activity_timeline.max_role_level',
  levelTimeDimension: 'user_activity_timeline.log_date',
  rechargeMember: 'user_recharge_timeline.revenue_vnd',
  rechargeTimeDimension: 'user_recharge_timeline.log_date',
};

// Ballistar: same shape minus engagement_segment (not in its mf_users).
const BALLISTAR_SECTIONS: Member360Sections = {
  ...CFM_SECTIONS,
  badges: CFM_SECTIONS.badges.filter((b) => b.field !== 'engagement_segment'),
  statusChips: CFM_SECTIONS.statusChips.filter((f) => f.field !== 'engagement_segment'),
};

const SECTIONS_BY_GAME: Record<string, Member360Sections> = {
  cfm: CFM_SECTIONS,
  cfm_vn: CFM_SECTIONS,
  ballistar: BALLISTAR_SECTIONS,
  ballistar_vn: BALLISTAR_SECTIONS,
};

export function sectionsForGame(gameId: string | null | undefined): Member360Sections | null {
  if (!gameId) return null;
  return SECTIONS_BY_GAME[gameId] ?? null;
}

/** All profile (`user_profile.*`) members the top-of-page sections read — one query. */
export function profileMembers(s: Member360Sections): string[] {
  const fields = new Set<string>(['user_id']);
  const flat: FieldRef[] = [
    ...s.pills,
    s.monetization.primary,
    ...s.monetization.stats,
    ...s.profileGroups.flatMap((g) => g.fields),
    ...s.statusChips,
    ...s.acquisitionTimeline,
    ...s.acquisitionChips,
    ...s.milestones,
  ];
  for (const f of flat) fields.add(f.field);
  for (const seg of s.monetization.split ?? []) fields.add(seg.field);
  for (const b of s.badges) fields.add(b.field);
  for (const lf of s.locationFields ?? []) fields.add(lf);
  return [...fields].map(qualify);
}
