/**
 * Seed registry — the 21 VIP-care playbooks from VIP_Data_Requirement_Final.docx,
 * encoded as ONE declarative config shape. The whole design rests on uniformity:
 * one shape renders all 21 in the monitor, gates each by live data presence, and
 * self-calibrates thresholds. Adding/editing a playbook = editing config, never code.
 *
 * Logical Cube member names below are best-effort and MUST be reconciled against
 * the live /meta during integration/calibration (run where the workspace is
 * reachable). A wrong/absent member fails CLOSED — the playbook renders
 * `unavailable` and issues no cohort query — so a naming mismatch is safe, never
 * a silent wrong-cohort. Override rows (Phase 6) layer on top of these seeds.
 */

import type { ThresholdRule } from './threshold-rule.js';

export type PlaybookGroup = 'payment' | 'ingame' | 'churn' | 'event';
export type PlaybookPriority = 'cao' | 'tb' | 'thap';

export interface WatchedMetric {
  member: string;
  label: string;
  kpiTarget?: string;
}

export interface PlaybookAction {
  text: string;
  channels: string[]; // 'in_game' | 'zalo_zns' | 'call' | 'push'
  slaMinutes?: number;
}

export interface AvailabilityHints {
  /** Driven by an ops calendar / manual input, not a cube member → always `partial`. */
  opsDriven?: boolean;
  /** No data source in any modeled game → always `unavailable` (renders, never enables). */
  blocked?: boolean;
}

export interface Playbook {
  id: string; // "01".."21"
  nhom: 1 | 2 | 3 | 4;
  group: PlaybookGroup;
  name: string;
  priority: PlaybookPriority;
  /** Logical Cube members that MUST exist for this playbook to be cohort-queryable. */
  dataRequirements: string[];
  condition: ThresholdRule;
  watchedMetric: WatchedMetric;
  action: PlaybookAction;
  /** Hints the availability resolver uses beyond raw member presence. */
  availabilityHints?: AvailabilityHints;
}

// Cumulative LTV tier bands (doc ₫5/20/50/100M). Starter values — Phase-0
// calibration confirms band populations against live mf_users.
// Mirrored client-side in src/pages/Dashboards/cs/vip-tier.ts (TIER_BANDS) for the
// VIP tier badge — keep the two in lock-step if these thresholds change.
const LTV_BANDS = [
  { label: 'tier1_5m', min: 5_000_000 },
  { label: 'tier2_20m', min: 20_000_000 },
  { label: 'tier3_50m', min: 50_000_000 },
  { label: 'tier4_100m', min: 100_000_000 },
];

const tier = <T extends ThresholdRule>(r: T) => r;

export const SEED_PLAYBOOKS: Playbook[] = [
  // ───────────────────────── NHÓM 1 · Payment ─────────────────────────
  {
    id: '01',
    nhom: 1,
    group: 'payment',
    name: 'First deposit',
    priority: 'tb',
    dataRequirements: ['mf_users.first_recharge_date'],
    condition: tier({ kind: 'event', member: 'mf_users.first_recharge_date', window: 'last 24 hours' }),
    watchedMetric: { member: 'user_recharge_daily.revenue_vnd', label: 'Day-7 spend', kpiTarget: 'second deposit within 7d' },
    action: { text: 'Welcome the new payer; thank-you note + onboarding offer', channels: ['in_game', 'zalo_zns'], slaMinutes: 1440 },
  },
  {
    id: '02',
    nhom: 1,
    group: 'payment',
    name: 'VIP tier reached',
    priority: 'cao',
    dataRequirements: ['mf_users.ltv_total_vnd'],
    condition: tier({ kind: 'tierStep', member: 'mf_users.ltv_total_vnd', bands: LTV_BANDS }),
    watchedMetric: { member: 'mf_users.ltv_total_vnd', label: 'Cumulative LTV', kpiTarget: 'ARPU90d sustained post-treatment' },
    action: { text: 'Congratulate on tier; deliver tier benefits + dedicated AM intro', channels: ['call', 'zalo_zns'], slaMinutes: 720 },
  },
  {
    id: '03',
    nhom: 1,
    group: 'payment',
    name: 'Spend spike',
    priority: 'cao',
    dataRequirements: ['user_recharge_daily.revenue_vnd', 'user_recharge_daily.recharge_date'],
    // ≥3× personal daily average — per-member comparison (trigger engine).
    condition: tier({ kind: 'ratio', member: 'user_recharge_daily.revenue_1d', vs: 'user_recharge_daily.revenue_30d_avg', value: 3, op: 'gte' }),
    watchedMetric: { member: 'user_recharge_daily.revenue_vnd', label: '7d spend', kpiTarget: 'no refund / chargeback' },
    action: { text: 'Acknowledge big spend; VIP perk + fraud/refund sanity check', channels: ['call'], slaMinutes: 240 },
  },
  {
    id: '04',
    nhom: 1,
    group: 'payment',
    name: 'Spend drop',
    priority: 'cao',
    dataRequirements: ['user_recharge_daily.revenue_vnd', 'user_recharge_daily.recharge_date'],
    // Rolling 7d spend < 30% of personal 30d avg — per-member (trigger engine).
    condition: tier({ kind: 'ratio', member: 'user_recharge_daily.revenue_7d', vs: 'user_recharge_daily.revenue_30d_avg', value: 0.3, op: 'lt' }),
    watchedMetric: { member: 'user_recharge_daily.revenue_vnd', label: '7d spend recovery', kpiTarget: 'spend back ≥ 60% baseline in 14d' },
    action: { text: 'Reach out; understand friction, targeted retention offer', channels: ['call', 'zalo_zns'], slaMinutes: 1440 },
  },
  {
    id: '05',
    nhom: 1,
    group: 'payment',
    name: 'Payment failure',
    priority: 'cao',
    dataRequirements: ['payment_txn.failed_count'], // no source modeled in any game
    condition: tier({ kind: 'abs', member: 'payment_txn.failed_count', op: 'gte', value: 1 }),
    watchedMetric: { member: 'payment_txn.failed_count', label: 'Failed txns', kpiTarget: 'successful retry' },
    action: { text: 'Assist with failed payment; alternative channel', channels: ['call', 'zalo_zns'], slaMinutes: 120 },
    availabilityHints: { blocked: true },
  },

  // ───────────────────────── NHÓM 2 · In-game behavior ─────────────────────────
  {
    id: '06',
    nhom: 2,
    group: 'ingame',
    name: 'Top leaderboard',
    priority: 'tb',
    dataRequirements: ['user_gameplay_daily.ladder_rank'],
    condition: tier({ kind: 'abs', member: 'user_gameplay_daily.ladder_rank', op: 'lte', value: 10 }),
    watchedMetric: { member: 'user_gameplay_daily.ladder_rank', label: 'Ladder rank', kpiTarget: 'rank retained' },
    action: { text: 'Recognize top performer; spotlight + exclusive reward', channels: ['in_game', 'zalo_zns'], slaMinutes: 1440 },
  },
  {
    id: '07',
    nhom: 2,
    group: 'ingame',
    name: 'Cosmetic / rare unlock',
    priority: 'thap',
    dataRequirements: ['etl_prop_flow.prop_id'], // raw event table → per-member only
    condition: tier({ kind: 'event', member: 'etl_prop_flow.acquired_at', window: 'last 24 hours' }),
    watchedMetric: { member: 'etl_prop_flow.prop_id', label: 'Rare items owned', kpiTarget: 'continued engagement' },
    action: { text: 'Congratulate on rare unlock; collector recognition', channels: ['in_game'], slaMinutes: 2880 },
  },
  {
    id: '08',
    nhom: 2,
    group: 'ingame',
    name: 'Rank drop / loss streak',
    priority: 'tb',
    dataRequirements: ['user_gameplay_daily.ladder_rank_drop_48h'],
    condition: tier({ kind: 'abs', member: 'user_gameplay_daily.ladder_rank_drop_48h', op: 'gt', value: 5 }),
    watchedMetric: { member: 'user_gameplay_daily.ladder_rank', label: 'Ladder rank', kpiTarget: 'rank recovery' },
    action: { text: 'Encourage after slump; coaching tips + morale boost', channels: ['in_game', 'push'], slaMinutes: 1440 },
  },
  {
    id: '09',
    nhom: 2,
    group: 'ingame',
    name: 'Major achievement',
    priority: 'tb',
    dataRequirements: ['user_gameplay_daily.ladder_rank'],
    condition: tier({ kind: 'abs', member: 'user_gameplay_daily.ladder_rank', op: 'equals', value: 1 }),
    watchedMetric: { member: 'user_gameplay_daily.ladder_rank', label: 'Top-1 status', kpiTarget: 'retention' },
    action: { text: 'Celebrate achievement; featured + premium reward', channels: ['in_game', 'zalo_zns'], slaMinutes: 1440 },
  },
  {
    id: '10',
    nhom: 2,
    group: 'ingame',
    name: 'Guild instability',
    priority: 'tb',
    dataRequirements: ['user_gameplay_daily.clan_rank'], // partial: derived from clan snapshot delta
    condition: tier({ kind: 'event', member: 'user_gameplay_daily.clan_rank_changed_at', window: 'last 48 hours' }),
    watchedMetric: { member: 'user_gameplay_daily.clan_rank', label: 'Clan rank', kpiTarget: 'stays in guild' },
    action: { text: 'Stabilize guild; offer support / mediation', channels: ['in_game'], slaMinutes: 1440 },
  },
  {
    id: '11',
    nhom: 2,
    group: 'ingame',
    name: 'Collector FOMO',
    priority: 'thap',
    dataRequirements: ['etl_prop_flow.prop_id'],
    condition: tier({ kind: 'abs', member: 'user_gameplay_daily.limited_set_owned_count', op: 'gte', value: 4 }),
    watchedMetric: { member: 'user_gameplay_daily.limited_set_owned_count', label: 'Set completion', kpiTarget: 'completes the set' },
    action: { text: 'Nudge on near-complete set; last-piece availability', channels: ['in_game', 'push'], slaMinutes: 2880 },
  },
  {
    id: '12',
    nhom: 2,
    group: 'ingame',
    name: 'Gacha bad-luck',
    priority: 'cao',
    dataRequirements: ['etl_lottery_shoot.history_draw_cnt'],
    condition: tier({ kind: 'abs', member: 'etl_lottery_shoot.draws_since_ssr', op: 'gte', value: 70 }),
    watchedMetric: { member: 'etl_lottery_shoot.draws_since_ssr', label: 'Draws since SSR', kpiTarget: 'continued play after pity' },
    action: { text: 'Soften bad-luck streak; goodwill compensation', channels: ['in_game', 'zalo_zns'], slaMinutes: 720 },
  },
  {
    id: '13',
    nhom: 2,
    group: 'ingame',
    name: 'Negative sentiment',
    priority: 'cao',
    dataRequirements: ['chat_sentiment.score'], // no source modeled
    condition: tier({ kind: 'abs', member: 'chat_sentiment.score', op: 'lt', value: 0 }),
    watchedMetric: { member: 'chat_sentiment.score', label: 'Sentiment', kpiTarget: 'sentiment recovers' },
    action: { text: 'De-escalate; personal outreach', channels: ['call'], slaMinutes: 240 },
    availabilityHints: { blocked: true },
  },

  // ───────────────────────── NHÓM 3 · Churn risk ─────────────────────────
  {
    id: '14',
    nhom: 3,
    group: 'churn',
    name: 'No login ≥ N days',
    priority: 'cao',
    dataRequirements: ['mf_users.days_since_last_active'],
    // Most-aggressive tier threshold as the cohort gate; tier-stepped N (3/5/7
    // by tier) refined in the engine snapshot.
    condition: tier({ kind: 'abs', member: 'mf_users.days_since_last_active', op: 'gte', value: 3 }),
    watchedMetric: { member: 'mf_users.days_since_last_active', label: 'Days since active', kpiTarget: 'returns within 7d' },
    action: { text: 'Win-back lapsing VIP; comeback incentive', channels: ['zalo_zns', 'call'], slaMinutes: 720 },
  },
  {
    id: '15',
    nhom: 3,
    group: 'churn',
    name: 'Session-time drop',
    priority: 'tb',
    dataRequirements: ['active_daily.online_time_sec', 'active_daily.active_date'],
    // 7d avg session < 40% of prior-30d avg — per-member (trigger engine).
    condition: tier({ kind: 'ratio', member: 'active_daily.session_7d_avg', vs: 'active_daily.session_30d_avg', value: 0.4, op: 'lt' }),
    watchedMetric: { member: 'active_daily.online_time_sec', label: 'Avg session', kpiTarget: 'session time recovers' },
    action: { text: 'Re-engage; surface fresh content / events', channels: ['push', 'zalo_zns'], slaMinutes: 1440 },
  },
  {
    id: '16',
    nhom: 3,
    group: 'churn',
    name: 'Negative support ticket',
    priority: 'cao',
    dataRequirements: ['support_ticket.sentiment'], // no source modeled
    condition: tier({ kind: 'abs', member: 'support_ticket.sentiment', op: 'lt', value: 0 }),
    watchedMetric: { member: 'support_ticket.sentiment', label: 'Ticket sentiment', kpiTarget: 'resolved + satisfied' },
    action: { text: 'Prioritize resolution; follow-up on VIP ticket', channels: ['call'], slaMinutes: 240 },
    availabilityHints: { blocked: true },
  },
  {
    id: '17',
    nhom: 3,
    group: 'churn',
    name: 'Leave / disband guild',
    priority: 'tb',
    dataRequirements: ['user_gameplay_daily.clan_id'], // partial: clan snapshot diff
    condition: tier({ kind: 'event', member: 'user_gameplay_daily.clan_left_at', window: 'last 48 hours' }),
    watchedMetric: { member: 'user_gameplay_daily.clan_id', label: 'Guild membership', kpiTarget: 'rejoins / stays active' },
    action: { text: 'Reconnect socially; suggest active guilds', channels: ['in_game', 'push'], slaMinutes: 1440 },
  },

  // ───────────────────────── NHÓM 4 · Time & event ─────────────────────────
  {
    id: '18',
    nhom: 4,
    group: 'event',
    name: 'Anniversary',
    priority: 'thap',
    dataRequirements: ['mf_users.first_active_date'],
    // Offset-day match {30,90,180,365,730} computed per-member in the engine; the
    // cohort gate is "has a first_active_date" (event member presence).
    condition: tier({ kind: 'event', member: 'mf_users.first_active_date', window: 'anniversary' }),
    watchedMetric: { member: 'mf_users.ltv_total_vnd', label: 'LTV', kpiTarget: 'engagement on milestone' },
    action: { text: 'Celebrate anniversary; milestone gift', channels: ['zalo_zns', 'in_game'], slaMinutes: 1440 },
  },
  {
    id: '19',
    nhom: 4,
    group: 'event',
    name: 'Pre-major-patch',
    priority: 'thap',
    dataRequirements: [], // ops calendar
    condition: tier({ kind: 'event', member: 'ops_calendar.next_patch_at', window: 'next 3 days' }),
    watchedMetric: { member: 'mf_users.days_since_last_active', label: 'Pre-patch activity', kpiTarget: 'logs in for patch' },
    action: { text: 'Tease upcoming patch; build anticipation', channels: ['push', 'zalo_zns'], slaMinutes: 2880 },
    availabilityHints: { opsDriven: true },
  },
  {
    id: '20',
    nhom: 4,
    group: 'event',
    name: 'New faction / server',
    priority: 'thap',
    dataRequirements: [], // ops event
    condition: tier({ kind: 'event', member: 'ops_calendar.new_content_at', window: 'next 7 days' }),
    watchedMetric: { member: 'mf_users.days_since_last_active', label: 'New-content uptake', kpiTarget: 'tries new content' },
    action: { text: 'Invite to new content; early-access perk', channels: ['push', 'in_game'], slaMinutes: 2880 },
    availabilityHints: { opsDriven: true },
  },
  {
    id: '21',
    nhom: 4,
    group: 'event',
    name: 'Birthday',
    priority: 'thap',
    dataRequirements: ['mf_users.birth_date'], // demographics not modeled
    condition: tier({ kind: 'event', member: 'mf_users.birth_date', window: 'birthday' }),
    watchedMetric: { member: 'mf_users.ltv_total_vnd', label: 'LTV', kpiTarget: 'birthday engagement' },
    action: { text: 'Birthday wishes; personalized gift', channels: ['zalo_zns'], slaMinutes: 1440 },
    availabilityHints: { blocked: true },
  },
];

/** Lookup a seed playbook by id. */
export function getSeedPlaybook(id: string): Playbook | undefined {
  return SEED_PLAYBOOKS.find((p) => p.id === id);
}
