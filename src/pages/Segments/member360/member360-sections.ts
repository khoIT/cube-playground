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

export interface Member360Sections {
  /** 4 headline pills in the hero. */
  pills: FieldRef[];
  badges: BadgeRef[];
  /** `country · os` style location chip (joined, omitted if both blank). */
  locationFields?: [string, string];
  monetization: FieldRef[];
  profileStatus: FieldRef[];
  acquisition: FieldRef[];
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
    { field: 'last_active_date', label: 'Last active' },
  ],
  badges: [
    { field: 'payer_tier', icon: '🏆', kind: 'value' },
    { field: 'lifecycle_stage', icon: '⏱️', kind: 'value' },
    { field: 'engagement_segment', icon: '🔥', kind: 'value' },
    { field: 'is_paying_user', icon: '💳', kind: 'flag', flagLabel: 'Paying' },
  ],
  locationFields: ['country', 'os_platform'],
  monetization: [
    { field: 'ltv_vnd', label: 'Lifetime LTV', icon: '💎', format: 'currency' },
    { field: 'ltv_30d_vnd', label: 'LTV 30d', icon: '📈', format: 'currency' },
    { field: 'is_paying_user', label: 'Paying', icon: '✅' },
    { field: 'ltv_iap_vnd', label: 'LTV — IAP', icon: '📲', format: 'currency' },
    { field: 'ltv_web_vnd', label: 'LTV — Web', icon: '🌐', format: 'currency' },
    { field: 'lifetime_txn_count', label: 'Lifetime txns', icon: '🧾', format: 'number' },
    { field: 'txn_count_30d', label: 'Txns 30d', icon: '🎟️', format: 'number' },
    { field: 'first_recharge_date', label: 'First recharge', icon: '🥇' },
    { field: 'last_recharge_date', label: 'Last recharge', icon: '🕐' },
  ],
  profileStatus: [
    { field: 'country', label: 'Country', icon: '🌍' },
    { field: 'os_platform', label: 'OS platform', icon: '📱' },
    { field: 'first_device_model', label: 'Device model', icon: '📲' },
    { field: 'last_server_id', label: 'Last server', icon: '🖥️' },
    { field: 'max_role_level', label: 'Max level', icon: '⭐', format: 'number' },
    { field: 'max_vip_level', label: 'Max VIP', icon: '👑', format: 'number' },
    { field: 'engagement_segment', label: 'Engagement', icon: '🔥' },
    { field: 'lifecycle_stage', label: 'Lifecycle', icon: '⏱️' },
    { field: 'last_login_country', label: 'Last login country', icon: '🌐' },
    { field: 'days_since_install', label: 'Days since install', icon: '🗓️', format: 'number' },
    { field: 'days_since_last_active', label: 'Days since active', icon: '😴', format: 'number' },
  ],
  acquisition: [
    { field: 'install_date', label: 'Install date', icon: '📅' },
    { field: 'install_month', label: 'Install month', icon: '🗓️' },
    { field: 'media_source', label: 'Media source', icon: '📣' },
    { field: 'is_paid_install', label: 'Paid install', icon: '💰' },
    { field: 'first_login_date', label: 'First login', icon: '🔑' },
    { field: 'first_login_channel', label: 'First login channel', icon: '📕' },
    { field: 'last_login_date', label: 'Last login', icon: '🔄' },
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
  profileStatus: CFM_SECTIONS.profileStatus.filter((f) => f.field !== 'engagement_segment'),
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
  for (const f of [...s.pills, ...s.monetization, ...s.profileStatus, ...s.acquisition, ...s.milestones]) {
    fields.add(f.field);
  }
  for (const b of s.badges) fields.add(b.field);
  for (const lf of s.locationFields ?? []) fields.add(lf);
  return [...fields].map(qualify);
}
