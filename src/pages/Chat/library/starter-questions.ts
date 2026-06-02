/**
 * Starter Library — 18 canonical business questions surfaced as clickable
 * cards on the chat landing page (phase-01).
 *
 * Each starter declares:
 *   - persona tags (filters)
 *   - categoryTags = intent-router categories (drives histogram ranking)
 *   - targetCatalogIds = catalog ids referenced; a CI test asserts they
 *     resolve via use-catalog-meta (no parallel definitions allowed).
 *
 * Cold-start (sessions < STARTER_RANK_MIN_SESSIONS) shows all 18 unranked.
 * After threshold, persona-histogram.ts cosine-ranks by user topic mix.
 */

export type StarterPersona = 'pm' | 'marketer' | 'analyst';

/**
 * Intent-router categories. Must stay in sync with chat-service skills
 * (diagnose | metric_explain | explore | compare).
 */
export type StarterCategory =
  | 'explore'
  | 'metric_explain'
  | 'compare'
  | 'diagnose';

export interface StarterQuestion {
  id: string;
  text: string;
  personaTags: ReadonlyArray<StarterPersona>;
  categoryTags: ReadonlyArray<StarterCategory>;
  /**
   * Catalog ids this question is likely to touch — used for CI gate that
   * every starter resolves through the live catalog meta. Format:
   * `business_metrics/<id>` or `cube.member`.
   */
  targetCatalogIds: ReadonlyArray<string>;
}

export const STARTER_QUESTIONS: ReadonlyArray<StarterQuestion> = [
  // ---- PM-leaning (retention curves, lifecycle & engagement segments) ----
  {
    id: 'dau-trend',
    text: 'How is DAU trending over the last 30 days?',
    personaTags: ['pm', 'analyst'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/dau'],
  },
  {
    id: 'new-cohort-retention-curve',
    text: "Plot the D1 → D30 retention curve for this month's new-player cohort",
    personaTags: ['pm', 'analyst'],
    categoryTags: ['metric_explain', 'explore'],
    targetCatalogIds: ['new_user_retention.rnru_d7', 'new_user_retention.retention_d30'],
  },
  {
    id: 'retention-cohort-compare',
    text: 'Compare retention curves across the last three install cohorts',
    personaTags: ['pm', 'analyst'],
    categoryTags: ['compare'],
    targetCatalogIds: ['new_user_retention.rnru_d1', 'new_user_retention.rnru_d7', 'new_user_retention.rnru_d30'],
  },
  {
    id: 'lifecycle-mix',
    text: 'Break down the player base by lifecycle stage',
    personaTags: ['pm', 'analyst'],
    categoryTags: ['explore'],
    targetCatalogIds: ['mf_users.lifecycle_stage', 'mf_users.user_count'],
  },
  {
    id: 'dormant-whales',
    text: "Which whales haven't logged in for 7+ days? (win-back list)",
    personaTags: ['pm', 'marketer'],
    categoryTags: ['explore', 'diagnose'],
    targetCatalogIds: ['mf_users.payer_tier', 'mf_users.days_since_last_active'],
  },
  {
    id: 'churn-risk-payers',
    text: 'Build a segment of paying users flagged as high churn-risk',
    personaTags: ['pm', 'analyst'],
    categoryTags: ['diagnose', 'explore'],
    targetCatalogIds: ['mf_users.churn_risk', 'mf_users.payer_tier'],
  },
  // ---- Marketer-leaning (acquisition economics: spend / CPI / ROAS / quality) ----
  {
    id: 'spend-by-channel',
    text: 'How is marketing spend split across acquisition channels this month?',
    personaTags: ['marketer'],
    categoryTags: ['explore', 'compare'],
    targetCatalogIds: ['marketing_cost.cost_vnd', 'business_metrics/cost'],
  },
  {
    id: 'cpi-by-channel',
    text: 'Which acquisition channels have the best CPI right now?',
    personaTags: ['marketer'],
    categoryTags: ['compare', 'explore'],
    targetCatalogIds: ['game_key_metrics.cpi_vnd', 'business_metrics/cpi'],
  },
  {
    id: 'top-campaigns-roas',
    text: 'Top 10 campaigns by ROAS this quarter',
    personaTags: ['marketer', 'analyst'],
    categoryTags: ['explore', 'compare'],
    targetCatalogIds: ['game_key_metrics.roas', 'business_metrics/roas'],
  },
  {
    id: 'paid-vs-organic-quality',
    text: 'Compare paid vs organic install quality — D7 retention and payer rate',
    personaTags: ['marketer', 'analyst'],
    categoryTags: ['compare', 'diagnose'],
    targetCatalogIds: ['game_key_metrics.retention_d7', 'game_key_metrics.payer_rate'],
  },
  {
    id: 'spend-to-purchase-funnel',
    text: 'Trace the spend → install → new user → first purchase funnel by channel',
    personaTags: ['marketer', 'analyst'],
    categoryTags: ['explore', 'diagnose'],
    targetCatalogIds: ['game_key_metrics.cost_vnd', 'game_key_metrics.installs', 'game_key_metrics.npu'],
  },
  {
    id: 'high-ltv-source',
    text: 'Which acquisition sources bring the highest-LTV players?',
    personaTags: ['marketer', 'analyst'],
    categoryTags: ['compare', 'explore'],
    targetCatalogIds: ['mf_users.ltv_total_vnd', 'business_metrics/ltv'],
  },
  // ---- Analyst-leaning (monetization, payer value & outreach segments) ----
  {
    id: 'ltv-by-install-month',
    text: 'What is LTV by install-month cohort?',
    personaTags: ['analyst', 'marketer'],
    categoryTags: ['metric_explain', 'compare'],
    targetCatalogIds: ['mf_users.ltv_total_vnd', 'business_metrics/ltv'],
  },
  {
    id: 'revenue-by-payer-tier',
    text: 'How is revenue distributed across payer tiers (whale / dolphin / minnow)?',
    personaTags: ['analyst', 'pm'],
    categoryTags: ['explore', 'compare'],
    targetCatalogIds: ['mf_users.payer_tier', 'mf_users.ltv_total_vnd'],
  },
  {
    id: 'vip-outreach-list',
    text: 'Give me a prioritized list of top VIP players — by VIP level and lifetime spend — for the CS team to reach out to',
    personaTags: ['pm', 'marketer'],
    categoryTags: ['explore'],
    targetCatalogIds: ['mf_users.max_vip_level', 'mf_users.ltv_vnd', 'mf_users.payer_tier'],
  },
  {
    id: 'reactivation-targets',
    text: 'Find lapsed high-value players to win back — paid before, inactive 14+ days',
    personaTags: ['marketer', 'analyst'],
    categoryTags: ['explore', 'diagnose'],
    targetCatalogIds: ['mf_users.days_since_last_active', 'mf_users.ltv_vnd'],
  },
  {
    id: 'new-payer-velocity',
    text: 'What share of new users convert to payers within 7 days?',
    personaTags: ['analyst', 'marketer'],
    categoryTags: ['metric_explain', 'explore'],
    targetCatalogIds: ['new_user_retention.rpnpu_d7', 'business_metrics/paying_rate'],
  },
  {
    id: 'platform-arpu-compare',
    text: 'Compare iOS vs Android ARPU and revenue this month',
    personaTags: ['analyst', 'marketer', 'pm'],
    categoryTags: ['compare'],
    targetCatalogIds: ['mf_users.arpu_vnd', 'business_metrics/arpu'],
  },
];

export const STARTER_CATEGORIES: ReadonlyArray<StarterCategory> = [
  'explore',
  'metric_explain',
  'compare',
  'diagnose',
];

export const STARTER_PERSONAS: ReadonlyArray<StarterPersona> = [
  'pm',
  'marketer',
  'analyst',
];

/**
 * Cold-start threshold — must match chat-service config
 * `starterRankMinSessions`. Hardcoded here to avoid a runtime fetch just to
 * read a constant (the FE has no other reason to call chat-service config).
 */
export const STARTER_RANK_MIN_SESSIONS = 3;
