/**
 * Illustrative care-history data for the CS Member-360.
 *
 * The care_cases ledger records when a case opened, but treatment outcomes
 * (channel, script, KPI result, agent notes) are not captured yet — so the
 * timeline and the recommended-action rail below are a designed SAMPLE, not live
 * data. Everything here is clearly labelled "sample" in the UI. Flavoured for
 * cfm_vn (Crossfire Legends VN) so the demo reads like the real CS workflow.
 */

export type CareEventKind = 'opened' | 'treated' | 'resolved' | 'note';
export type CarePriority = 'cao' | 'tb' | 'thap';
export type CareChannel = 'call' | 'zalo_zns' | 'in_game' | 'email';
export type CareOutcome = 'kpi_met' | 'kpi_missed' | 'pending';

export interface CareTimelineEvent {
  id: string;
  kind: CareEventKind;
  playbookId: string;
  playbookName: string;
  priority: CarePriority;
  /** Relative-day offset from "now" (negative = past). Rendered as an absolute time at runtime. */
  daysAgo: number;
  channel?: CareChannel;
  agent?: string;
  outcome?: CareOutcome;
  /** Headline metric the action moved (or aimed to). */
  kpi?: { label: string; before: string; after?: string };
  note?: string;
}

export interface RecommendedAction {
  playbookId: string;
  playbookName: string;
  priority: CarePriority;
  /** Why this VIP surfaced now — the deciding signal. */
  why: string;
  channels: CareChannel[];
  /** Suggested talk-track / opening line for the agent. */
  script: string;
  /** Cross-sell / retention bundle to offer. */
  bundle: string;
  /** Service-level reminder. */
  slaNote: string;
}

export const CHANNEL_LABEL: Record<CareChannel, string> = {
  call: 'Call',
  zalo_zns: 'Zalo ZNS',
  in_game: 'In-game DM',
  email: 'Email',
};

/** A worked care history showing the full open → treated → resolved lifecycle. */
export const SAMPLE_CARE_TIMELINE: CareTimelineEvent[] = [
  {
    id: 'evt-open-1',
    kind: 'opened',
    playbookId: '02',
    playbookName: 'VIP spend drop 14d',
    priority: 'cao',
    daysAgo: 0,
    kpi: { label: 'Recharge 14d', before: '₫0', after: undefined },
    note: 'Top-tier whale stopped recharging after a ₫48M month. No login dip yet — pure spend signal.',
  },
  {
    id: 'evt-open-2',
    kind: 'opened',
    playbookId: '11',
    playbookName: 'Rank-mode churn risk',
    priority: 'tb',
    daysAgo: 0,
    kpi: { label: 'Ranked matches 7d', before: '3', after: undefined },
    note: 'Ranked activity fell from 40+/wk to 3 — frustration or competitor pull.',
  },
  {
    id: 'evt-treat-1',
    kind: 'treated',
    playbookId: '14',
    playbookName: 'Lapsed event buyer',
    priority: 'tb',
    daysAgo: 9,
    channel: 'zalo_zns',
    agent: 'Linh · CS',
    outcome: 'kpi_met',
    kpi: { label: 'Event pack', before: 'not bought', after: '₫2.1M' },
    note: 'Sent the Lunar event bundle reminder via ZNS. Bought within 6h.',
  },
  {
    id: 'evt-resolve-1',
    kind: 'resolved',
    playbookId: '04',
    playbookName: 'First-recharge nurture',
    priority: 'thap',
    daysAgo: 23,
    channel: 'in_game',
    agent: 'auto-journey',
    outcome: 'kpi_met',
    kpi: { label: 'Repeat recharge', before: '1', after: '4' },
    note: 'Onboarding nudge series completed — graduated to regular spender.',
  },
  {
    id: 'evt-treat-2',
    kind: 'treated',
    playbookId: '02',
    playbookName: 'VIP spend drop 14d',
    priority: 'cao',
    daysAgo: 41,
    channel: 'call',
    agent: 'Khoa · CS Lead',
    outcome: 'kpi_missed',
    kpi: { label: 'Recharge 14d', before: '₫0', after: '₫0' },
    note: 'Personal call — VIP cited a balance complaint. Escalated to game team; no recharge that cycle.',
  },
];

/** The single most-urgent open case, surfaced as the next best action. */
export const SAMPLE_RECOMMENDED_ACTION: RecommendedAction = {
  playbookId: '02',
  playbookName: 'VIP spend drop 14d',
  priority: 'cao',
  why: 'Diamond whale (₫312M LTV) — recharge dropped to ₫0 over the last 14 days while still logging in daily. High save-value, still reachable.',
  channels: ['call', 'zalo_zns'],
  script:
    'Open warm, reference their clan’s recent ranked push. Ask about the balance complaint flagged last cycle before pitching anything.',
  bundle: 'Diamond loyalty pack + double-XP weekend pass (offer only after the concern is heard).',
  slaNote: 'Cao priority — first contact target within 24h of match.',
};
