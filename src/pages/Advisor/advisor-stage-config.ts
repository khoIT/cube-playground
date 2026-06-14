/**
 * Static configuration for the five experiment-anatomy stages and goal templates.
 *
 * Organized by the anatomy of an experiment — a left-to-right causal chain where
 * each stage produces ONE building block: Opportunity → Target → Cause → Lever → Proof.
 */

import type { Stage, GoalKey, GoalTemplate, StageKey } from './advisor-types';

export const STAGES: Stage[] = [
  {
    key: 'opportunity',
    label: 'Opportunity',
    emoji: '💰',
    q: `Where's the gap — and how big?`,
    builds: 'the prize & the success metric',
    good: `A number you'd defend to your boss — plus one obvious alternative ruled out.`,
    slotEmpty: 'how big?',
  },
  {
    key: 'target',
    label: 'Target',
    emoji: '🎯',
    q: 'Who exactly — and compared to whom?',
    builds: 'the cohort + a fair comparison group',
    good: 'A look-alike group so nobody can wave the gap away as "just normal".',
    slotEmpty: 'who?',
  },
  {
    key: 'cause',
    label: 'Cause',
    emoji: '🧠',
    q: 'Why is it happening?',
    builds: 'the hypothesis — the "because"',
    good: 'A reason that rules out the usual suspects: price? a few outliers? a one-off event?',
    slotEmpty: 'why?',
  },
  {
    key: 'lever',
    label: 'Lever',
    emoji: '🛠️',
    q: 'What can we do — that we actually can?',
    builds: 'the treatment (the action CS delivers)',
    good: 'An action matched to the cause AND deliverable today.',
    slotEmpty: 'do what?',
  },
  {
    key: 'proof',
    label: 'Proof',
    emoji: '📏',
    q: 'Will it work, and is it safe?',
    builds: 'expected lift, power check & guardrails',
    good: 'A measured prior, "big enough to tell", and safety rails.',
    slotEmpty: 'will it work?',
  },
];

export const GOAL_TEMPLATES: Record<GoalKey, GoalTemplate> = {
  revenue: {
    label: 'Make more money',
    tagline: 'recover the revenue slipping from these whales',
    sentence: [
      'Among ',
      'target',
      ' who ',
      'opportunity',
      ', we think the cause is ',
      'cause',
      ` — so we'll run `,
      'lever',
      ', expecting ',
      'proof',
      '.',
    ],
  },
  engagement: {
    label: 'Keep them playing',
    tagline: 'get them logging in & playing more — the signal before they stop paying',
    sentence: [
      'Among ',
      'target',
      ' who ',
      'opportunity',
      ', we think the cause is ',
      'cause',
      ` — so we'll run `,
      'lever',
      ', expecting ',
      'proof',
      '.',
    ],
  },
};

export const GOAL_CHIPS = [
  'Get my lapsing whales paying again',
  'Where am I losing money?',
  'Why are these whales playing less?',
  'Grow spend from my top payers',
];

/** Confidence display config. */
export const CONF_CONFIG: Record<'high' | 'med', { label: string; bg: string; ink: string }> = {
  high: { label: 'high confidence', bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  med: { label: 'an estimate', bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
};

/** Triage display config. */
export const TRIAGE_CONFIG: Record<
  'keep' | 'flag' | 'dismiss',
  { label: string; hint: string; bg: string; ink: string; icon: string }
> = {
  keep: {
    label: 'Keep',
    hint: 'true & load-bearing → fills the blueprint',
    bg: 'var(--success-soft)',
    ink: 'var(--success-ink)',
    icon: '✓',
  },
  flag: {
    label: 'Flag',
    hint: 'interesting but unsure → stays an open question',
    bg: 'var(--warning-soft)',
    ink: 'var(--warning-ink)',
    icon: '⚑',
  },
  dismiss: {
    label: 'Rule out',
    hint: `looked, but it doesn't change the plan`,
    bg: 'var(--muted-soft)',
    ink: 'var(--muted-ink)',
    icon: '✕',
  },
};

/** Feasibility display config for lever cards. */
export const FEAS_CONFIG: Record<'true' | 'partial' | 'false', { label: string; bg: string; ink: string }> = {
  true: { label: 'we can do this', bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  partial: { label: 'partly feasible', bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
  false: { label: 'not feasible yet', bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)' },
};

/**
 * Placeholder aspects for offline/demo use. In production the real data comes
 * from /api/advisor/diagnose; these are shown when that endpoint is unavailable
 * so the IA is navigable even without a live Cube connection.
 */
export const DEMO_ASPECTS_REVENUE = [
  { id: 'r-op1', stage: 'opportunity' as StageKey, q: 'How much money is at stake?', finding: `≈ 312M₫/month if the lapse isn't reversed. That's the prize.`, slot: 'are worth ≈312M₫/mo', conf: 'med' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-op2', stage: 'opportunity' as StageKey, q: 'How long since they last paid?', finding: '27–34 days ago vs 1–5 days for healthy whales — the clearest weak signal.', slot: 'last paid 27–34 days ago', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-op3', stage: 'opportunity' as StageKey, q: 'Is spend itself the problem?', finding: 'No — spend per whale is normal (1.18M₫). Rules out a pricing fix.', slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-tg1', stage: 'target' as StageKey, q: 'Compare to healthy look-alikes (same age & tier)', finding: 'They pay 31% less often than near-identical healthy whales — the fairest comparison, and it confirms the gap.', slot: '2,400 lapsing whales', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-tg2', stage: 'target' as StageKey, q: 'Compare to the whole payer base', finding: 'Also below the broad base — but the look-alike comparison is the trustworthy one.', slot: '', conf: 'med' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-tg3', stage: 'target' as StageKey, q: 'Whales we already won back before', finding: 'A real cohort we moved before — grounds the expected lift and gives us a precedent.', slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-ca1', stage: 'cause' as StageKey, q: 'Are they leaving over price, or just drifting?', finding: 'Drifting — they simply stopped showing up; spend is normal. A nudge fits, not a discount.', slot: `they're drifting (not price)`, conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-ca2', stage: 'cause' as StageKey, q: 'A few big whales, or the whole group?', finding: 'The whole group slid together — not 2 outliers. Treat it as a cohort.', slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-ca3', stage: 'cause' as StageKey, q: 'Did a patch or event cause it?', finding: 'No single event — a steady 60-day slide. Behavioural, not a shock.', slot: '', conf: 'med' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-lv1', stage: 'lever' as StageKey, q: 'Win-back CS comeback call', finding: 'Matches a drift cause and CS can deliver it today.', slot: 'a CS comeback call', conf: 'high' as const, feas: 'true' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-lv2', stage: 'lever' as StageKey, q: 'Re-engagement care touch', finding: `A lighter touch; CS can do it, but it's a weaker fit for a payment lapse.`, slot: 'a re-engagement touch', conf: 'med' as const, feas: 'true' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-lv3', stage: 'lever' as StageKey, q: 'Payment-friction recovery assist', finding: 'Only ~180 affected — a small side-fix, not the main lever.', slot: 'a payment-friction assist', conf: 'med' as const, feas: 'true' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-pf1', stage: 'proof' as StageKey, q: 'What lift can we expect? (past results)', finding: '+6 in 100 measured on cfm_vn whales before.', slot: '+6 in 100 (proven before)', conf: 'high' as const, basis: 'Based on 1 similar test on cfm_vn whales — a strong hint, not a promise.', on: true, state: 'idle' as const, triage: null },
  { id: 'r-pf2', stage: 'proof' as StageKey, q: 'Is the group big enough to prove it?', finding: 'Yes — 1,872 reachable gives a clear answer in 14 days.', slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'r-pf3', stage: 'proof' as StageKey, q: 'Is it safe for the whales?', finding: `Won't contact whales who paid in the last 7 days; hold-out measures real lift; max 1 contact/player.`, slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
];

export const DEMO_ASPECTS_ENGAGEMENT = [
  { id: 'e-op1', stage: 'opportunity' as StageKey, q: 'How much playtime is slipping?', finding: 'Logins fell from ~5/week to ~2/week over 60 days — the slide that precedes lapsing and churn.', slot: 'play half as often (5→2/wk)', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-op2', stage: 'opportunity' as StageKey, q: 'Is session length the problem?', finding: `No — sessions are normal length. It's how OFTEN they play, not how long.`, slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-op3', stage: 'opportunity' as StageKey, q: 'Does this lead to lost revenue?', finding: 'Yes — this drop precedes a ~312M₫ payment lapse. Engagement is the leading signal of revenue.', slot: 'are sliding toward a ≈312M₫ lapse', conf: 'med' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-tg1', stage: 'target' as StageKey, q: 'Compare to still-active look-alikes', finding: 'Active peers play ~5/week; this group halved. A real, fair gap.', slot: '1,900 sliding whales', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-tg2', stage: 'target' as StageKey, q: 'Compare to the whole base', finding: 'Below base too, but the active-look-alike comparison is the one to trust.', slot: '', conf: 'med' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-tg3', stage: 'target' as StageKey, q: 'A cohort we re-engaged before', finding: 'A Q1 re-engaged group — grounds the expected lift.', slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-ca1', stage: 'cause' as StageKey, q: 'Have they run out of content?', finding: `Likely — completion rates are high; they've exhausted fresh goals.`, slot: 'are out of fresh content', conf: 'med' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-ca2', stage: 'cause' as StageKey, q: 'Are they socially isolated (no guild)?', finding: '~60% are guild-less — a known churn driver.', slot: 'are mostly guild-less', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-ca3', stage: 'cause' as StageKey, q: 'Did the daily habit break?', finding: 'Daily-login streaks broke around day 30 — the habit lapsed.', slot: '', conf: 'med' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-lv1', stage: 'lever' as StageKey, q: 'Re-engagement care touch', finding: 'A CS check-in to restart the play habit. CS can deliver today.', slot: 'a re-engagement touch', conf: 'med' as const, feas: 'true' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-lv2', stage: 'lever' as StageKey, q: 'Guild-matchmaking nudge', finding: 'Pair guild-less whales into active guilds — matches the isolation cause.', slot: 'a guild-matchmaking nudge', conf: 'med' as const, feas: 'partial' as const, why: 'Needs LiveOps to wire the matchmaking hook.', sub: 'a CS re-engagement touch', on: true, state: 'idle' as const, triage: null },
  { id: 'e-lv3', stage: 'lever' as StageKey, q: 'Daily-loop reward nudge', finding: 'Restart streak rewards — fits the habit cause.', slot: 'a daily-loop nudge', conf: 'med' as const, feas: 'false' as const, why: `A LiveOps push channel we can't trigger from here yet.`, sub: 'a CS re-engagement touch', on: true, state: 'idle' as const, triage: null },
  { id: 'e-pf1', stage: 'proof' as StageKey, q: 'What lift can we expect?', finding: '+0.4 sessions/week — an estimate, untested on this cohort.', slot: '+0.4 sessions/wk (a bet)', conf: 'med' as const, basis: 'No past result for this cohort — running it is how we find out.', on: true, state: 'idle' as const, triage: null },
  { id: 'e-pf2', stage: 'proof' as StageKey, q: 'Is the group big enough?', finding: 'Yes — powered for a clear answer in 14 days.', slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
  { id: 'e-pf3', stage: 'proof' as StageKey, q: 'Is it safe?', finding: 'Max 1 contact per player; hold-out group measures the real lift.', slot: '', conf: 'high' as const, on: true, state: 'idle' as const, triage: null },
];

/** Pattern that indicates the advisor needs more context from the manager. */
export const NEEDS_INFO_REGEX =
  /(cost|price|competitor|benchmark|industry|store|portal|refund|budget|capacity|which (server|region|market)|how much should|compared to other game)/i;

/** Fallback finding copy for custom angles when Cube is unavailable. */
export const CUSTOM_FINDING: Record<string, string> = {
  opportunity:
    `There's a measurable gap here — size it next to the headline ₫ figure before you trust it. (Cube connection needed for live data.)`,
  target:
    'Built this as a comparison cut. Sanity-check the N before leaning on it. (Cube connection needed for live data.)',
  cause:
    `Plausible contributor — weigh it against the cause you've already kept. (Cube connection needed for live data.)`,
  lever:
    'CS could action a version of this. Confirm capacity before it becomes the lever. (Cube connection needed for live data.)',
  proof:
    'Quick power + safety read — factor it into the readout. (Cube connection needed for live data.)',
};
