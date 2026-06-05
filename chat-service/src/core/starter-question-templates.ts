/**
 * Deterministic starter-question template engine.
 *
 * Pure: `buildTemplateQuestions(meta)` → StarterQuestion[] with zero I/O.
 * Each template fires only when the members it needs actually exist in the
 * game's /meta, and emits `targetCatalogIds` referencing those REAL member
 * names — so the engine works unchanged across bare (local game_id) and
 * prefixed (prod) workspace models without hardcoding any cube name.
 *
 * Question intents mirror the static starter library
 * (src/pages/Chat/library/starter-questions.ts): business-performance
 * analytics biased toward analyses that end in a saveable segment
 * (win-back lists, churn-risk payers, VIP outreach).
 */

import type { StarterQuestion } from '../db/starter-questions-store.js';

interface MemberEntry {
  /** Full member ref, e.g. `cfm_mf_users.payer_tier`. */
  name: string;
  /** Field segment after the last dot, e.g. `payer_tier`. */
  field: string;
  role: 'measure' | 'dimension';
}

/** Field-segment lookup over every measure/dimension in the meta. */
class MemberIndex {
  private entries: MemberEntry[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(meta: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cubes: any[] = meta?.cubes ?? [];
    for (const cube of cubes) {
      for (const m of cube.measures ?? []) this.add(m.name, 'measure');
      for (const d of cube.dimensions ?? []) this.add(d.name, 'dimension');
    }
  }

  private add(name: unknown, role: MemberEntry['role']): void {
    if (typeof name !== 'string' || !name.includes('.')) return;
    const field = name.slice(name.lastIndexOf('.') + 1);
    this.entries.push({ name, field, role });
  }

  /** First member whose field segment equals `field` (anchored, no substring). */
  field(field: string, role?: MemberEntry['role']): string | undefined {
    return this.entries.find(
      (e) => e.field === field && (!role || e.role === role),
    )?.name;
  }

  /** First member matching any of the candidate field names, in order. */
  anyField(fields: string[], role?: MemberEntry['role']): string | undefined {
    for (const f of fields) {
      const hit = this.field(f, role);
      if (hit) return hit;
    }
    return undefined;
  }

  /** All members whose field segment starts with `prefix` (e.g. retention families). */
  fieldPrefix(prefix: string, role?: MemberEntry['role']): string[] {
    return this.entries
      .filter((e) => e.field.startsWith(prefix) && (!role || e.role === role))
      .map((e) => e.name);
  }
}

/** A template fires (returns a question) only when its members resolve. */
type Template = (idx: MemberIndex) => StarterQuestion | null;

const LTV_FIELDS = ['ltv_total_vnd', 'ltv_vnd', 'total_recharge_vnd', 'revenue_vnd'];

/**
 * Priority-ordered catalogue. Segment-arriving questions (win-back, churn,
 * VIP, reactivation) lead so sparse games surface them first.
 */
const TEMPLATES: Template[] = [
  (idx) => {
    const tier = idx.field('payer_tier', 'dimension');
    const idle = idx.field('days_since_last_active', 'dimension');
    if (!tier || !idle) return null;
    return q('dormant-whales', "Which whales haven't logged in for 7+ days? (win-back list)",
      ['liveops'], ['explore', 'diagnose'], [tier, idle]);
  },
  (idx) => {
    const churn = idx.field('churn_risk', 'dimension');
    const tier = idx.field('payer_tier', 'dimension');
    if (!churn || !tier) return null;
    return q('churn-risk-payers', 'Build a segment of paying users flagged as high churn-risk',
      ['liveops'], ['diagnose', 'explore'], [churn, tier]);
  },
  (idx) => {
    const vip = idx.field('max_vip_level', 'dimension');
    const ltv = idx.anyField(LTV_FIELDS, 'measure');
    if (!vip || !ltv) return null;
    return q('vip-outreach-list', 'Give me a prioritized list of top VIP players by VIP level and lifetime spend for CS outreach',
      ['monetization'], ['explore'], [vip, ltv]);
  },
  (idx) => {
    const idle = idx.field('days_since_last_active', 'dimension');
    const ltv = idx.anyField(LTV_FIELDS, 'measure');
    if (!idle || !ltv) return null;
    return q('reactivation-targets', 'Find lapsed high-value players to win back — paid before, inactive 14+ days',
      ['liveops', 'monetization'], ['explore', 'diagnose'], [idle, ltv]);
  },
  (idx) => {
    const tier = idx.field('payer_tier', 'dimension');
    const ltv = idx.anyField(LTV_FIELDS, 'measure');
    if (!tier || !ltv) return null;
    return q('revenue-by-payer-tier', 'How is revenue distributed across payer tiers (whale / dolphin / minnow)?',
      ['monetization'], ['explore', 'compare'], [tier, ltv]);
  },
  (idx) => {
    const stage = idx.field('lifecycle_stage', 'dimension');
    const count = idx.anyField(['user_count', 'users'], 'measure');
    if (!stage || !count) return null;
    return q('lifecycle-mix', 'Break down the player base by lifecycle stage',
      ['liveops'], ['explore'], [stage, count]);
  },
  (idx) => {
    const ltv = idx.anyField(LTV_FIELDS, 'measure');
    const cohort = idx.anyField(['install_month', 'first_seen_date', 'register_date', 'first_recharge_date'], 'dimension');
    if (!ltv || !cohort) return null;
    return q('ltv-by-install-cohort', 'What is LTV by install-month cohort?',
      ['user_acquisition', 'monetization'], ['metric_explain', 'compare'], [ltv, cohort]);
  },
  (idx) => {
    const retention = [...idx.fieldPrefix('rnru_d', 'measure'), ...idx.fieldPrefix('retention_d', 'measure')];
    if (retention.length === 0) return null;
    return q('new-cohort-retention-curve', "Plot the D1 → D30 retention curve for this month's new-player cohort",
      ['user_acquisition'], ['metric_explain', 'explore'], retention.slice(0, 3));
  },
  (idx) => {
    const retention = [...idx.fieldPrefix('rnru_d', 'measure'), ...idx.fieldPrefix('retention_d', 'measure')];
    if (retention.length < 2) return null;
    return q('retention-cohort-compare', 'Compare retention curves across the last three install cohorts',
      ['user_acquisition'], ['compare'], retention.slice(0, 3));
  },
  (idx) => {
    const dau = idx.anyField(['dau', 'active_users', 'active_user_count'], 'measure');
    if (!dau) return null;
    return q('dau-trend', 'How is DAU trending over the last 30 days?',
      ['liveops'], ['explore', 'metric_explain'], [dau]);
  },
  (idx) => {
    const cost = idx.anyField(['cost_vnd', 'cost', 'spend_vnd'], 'measure');
    if (!cost) return null;
    return q('spend-by-channel', 'How is marketing spend split across acquisition channels this month?',
      ['user_acquisition'], ['explore', 'compare'], [cost]);
  },
  (idx) => {
    const eff = idx.anyField(['cpi_vnd', 'cpi', 'roas'], 'measure');
    if (!eff) return null;
    return q('acquisition-efficiency', 'Which acquisition channels have the best CPI / ROAS right now?',
      ['user_acquisition'], ['compare', 'explore'], [eff]);
  },
  (idx) => {
    const arpu = idx.anyField(['arpu_vnd', 'arpu'], 'measure');
    const platform = idx.anyField(['platform', 'os', 'device_os'], 'dimension');
    if (!arpu || !platform) return null;
    return q('platform-arpu-compare', 'Compare iOS vs Android ARPU and revenue this month',
      ['monetization'], ['compare'], [arpu, platform]);
  },
  (idx) => {
    const npu = idx.anyField(['rpnpu_d7', 'npu', 'new_paying_users'], 'measure');
    if (!npu) return null;
    return q('new-payer-velocity', 'What share of new users convert to payers within 7 days?',
      ['monetization', 'user_acquisition'], ['metric_explain', 'explore'], [npu]);
  },
];

const MAX_QUESTIONS = 18;

function q(
  id: string,
  text: string,
  topicTags: StarterQuestion['topicTags'],
  categoryTags: StarterQuestion['categoryTags'],
  targetCatalogIds: string[],
): StarterQuestion {
  return { id, text, topicTags, categoryTags, targetCatalogIds };
}

/**
 * Build the deterministic baseline set for a game's meta. A sparse schema
 * yields a smaller set (possibly empty) — the caller decides when the result
 * is too thin to serve and falls back to the static library instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTemplateQuestions(meta: any): StarterQuestion[] {
  const idx = new MemberIndex(meta);
  const questions: StarterQuestion[] = [];
  for (const template of TEMPLATES) {
    const question = template(idx);
    if (question) questions.push(question);
    if (questions.length >= MAX_QUESTIONS) break;
  }
  return questions;
}
