/**
 * Starter Library — 16 canonical business questions surfaced as clickable
 * cards on the chat landing page (phase-01).
 *
 * Each starter declares:
 *   - persona tags (filters)
 *   - categoryTags = intent-router categories (drives histogram ranking)
 *   - targetCatalogIds = catalog ids referenced; a CI test asserts they
 *     resolve via use-catalog-meta (no parallel definitions allowed).
 *
 * Cold-start (sessions < STARTER_RANK_MIN_SESSIONS) shows all 16 unranked.
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
  // ---- PM-leaning (product / retention / engagement) ----
  {
    id: 'dau-trend',
    text: 'How is DAU trending over the last 30 days?',
    personaTags: ['pm', 'analyst'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/dau'],
  },
  {
    id: 'd7-retention',
    text: 'What is our D7 retention for new players this month?',
    personaTags: ['pm', 'analyst'],
    categoryTags: ['metric_explain', 'explore'],
    targetCatalogIds: ['business_metrics/d7_retention'],
  },
  {
    id: 'retention-curve-compare',
    text: 'Compare retention curves across the last three cohorts',
    personaTags: ['pm', 'analyst'],
    categoryTags: ['compare'],
    targetCatalogIds: ['business_metrics/d1_retention', 'business_metrics/d7_retention', 'business_metrics/d30_retention'],
  },
  {
    id: 'at-risk-whales',
    text: 'Which whales have not logged in this week?',
    personaTags: ['pm', 'marketer'],
    categoryTags: ['explore', 'diagnose'],
    targetCatalogIds: ['business_metrics/whale_payer'],
  },
  {
    id: 'session-length-drop',
    text: 'Why did average session length drop this week?',
    personaTags: ['pm', 'analyst'],
    categoryTags: ['diagnose'],
    targetCatalogIds: ['business_metrics/avg_session_length'],
  },
  // ---- Marketer-leaning (revenue / campaigns / acquisition) ----
  {
    id: 'revenue-7d',
    text: 'Show daily revenue for the last 7 days',
    personaTags: ['marketer', 'analyst', 'pm'],
    categoryTags: ['explore'],
    targetCatalogIds: ['business_metrics/revenue'],
  },
  {
    id: 'arpdau-mom',
    text: 'Compare ARPDAU month-over-month',
    personaTags: ['marketer', 'analyst'],
    categoryTags: ['compare', 'metric_explain'],
    targetCatalogIds: ['business_metrics/arpdau'],
  },
  {
    id: 'top-campaigns-roas',
    text: 'Top 10 campaigns by ROAS this quarter',
    personaTags: ['marketer'],
    categoryTags: ['explore', 'compare'],
    targetCatalogIds: ['business_metrics/roas'],
  },
  {
    id: 'cpi-by-channel',
    text: 'Break down CPI by acquisition channel',
    personaTags: ['marketer'],
    categoryTags: ['explore', 'compare'],
    targetCatalogIds: ['business_metrics/cpi'],
  },
  {
    id: 'revenue-by-country',
    text: 'Where is revenue concentrated by country?',
    personaTags: ['marketer', 'analyst'],
    categoryTags: ['explore', 'compare'],
    targetCatalogIds: ['business_metrics/revenue'],
  },
  // ---- Analyst-leaning (conversion / funnels / diagnostics) ----
  {
    id: 'ltv-by-cohort',
    text: 'What is LTV by install cohort?',
    personaTags: ['analyst', 'marketer'],
    categoryTags: ['metric_explain', 'compare'],
    targetCatalogIds: ['business_metrics/ltv'],
  },
  {
    id: 'conversion-funnel',
    text: 'Walk me through the install → first-purchase funnel',
    personaTags: ['analyst', 'pm'],
    categoryTags: ['explore', 'diagnose'],
    targetCatalogIds: ['business_metrics/first_purchase_rate'],
  },
  {
    id: 'churn-spike',
    text: 'Why did churn spike for week-old players?',
    personaTags: ['analyst', 'pm'],
    categoryTags: ['diagnose'],
    targetCatalogIds: ['business_metrics/churn_rate'],
  },
  {
    id: 'payer-conversion',
    text: 'What fraction of DAU converted to paying users last week?',
    personaTags: ['analyst', 'marketer'],
    categoryTags: ['metric_explain', 'explore'],
    targetCatalogIds: ['business_metrics/payer_conversion_rate'],
  },
  {
    id: 'compare-platforms',
    text: 'Compare iOS vs Android revenue this month',
    personaTags: ['analyst', 'marketer', 'pm'],
    categoryTags: ['compare'],
    targetCatalogIds: ['business_metrics/revenue'],
  },
  {
    id: 'arpu-by-country',
    text: 'Which countries have the highest ARPU?',
    personaTags: ['analyst', 'marketer'],
    categoryTags: ['explore', 'compare'],
    targetCatalogIds: ['business_metrics/arpu'],
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
