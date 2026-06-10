/**
 * Starter Library — 18 canonical business questions surfaced as clickable
 * cards on the chat landing page (phase-01).
 *
 * Each starter declares:
 *   - topic tags (publishing-business filters: LiveOps / UA / Monetization)
 *   - categoryTags = intent-router categories (drives histogram ranking)
 *   - targetCatalogIds = catalog ids referenced; a CI test asserts they
 *     resolve via use-catalog-meta (no parallel definitions allowed).
 *
 * Cold-start (sessions < STARTER_RANK_MIN_SESSIONS) shows all 18 unranked.
 * After threshold, persona-histogram.ts cosine-ranks by user intent mix.
 */

/**
 * Publishing-business topics — the filter chips above the starter grid.
 * Must stay in sync with chat-service starter-question generation
 * (chat-service/src/db/starter-questions-store.ts).
 */
export type StarterTopic = 'liveops' | 'user_acquisition' | 'monetization';

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
  topicTags: ReadonlyArray<StarterTopic>;
  categoryTags: ReadonlyArray<StarterCategory>;
  /**
   * Catalog ids this question is likely to touch — used for CI gate that
   * every starter resolves through the live catalog meta. Format:
   * `business_metrics/<id>` or `cube.member`.
   */
  targetCatalogIds: ReadonlyArray<string>;
  /**
   * Serve-time enrichment on generated sets: latest date with data when the
   * question's cube lags >14 days behind today. Renders as a transparency
   * badge ("Data through Apr 30"). Absent on the static library.
   */
  dataThrough?: string;
}

export const STARTER_QUESTIONS: ReadonlyArray<StarterQuestion> = [
  // ---- Revenue / Payments — fast metrics ----
  {
    id: 'revenue-trend-30d',
    text: 'How has revenue trended over the last 30 days?',
    topicTags: ['monetization'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/revenue'],
  },
  {
    id: 'arppu-by-platform',
    text: 'ARPPU broken down by platform (iOS vs Android) this month',
    topicTags: ['monetization'],
    categoryTags: ['compare', 'explore'],
    targetCatalogIds: ['business_metrics/arppu'],
  },
  {
    id: 'iap-revenue-trend',
    text: 'What is the IAP revenue trend over the last 14 days?',
    topicTags: ['monetization'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/iap_revenue'],
  },
  // ---- Engagement — fast metrics ----
  {
    id: 'dau-trend',
    text: 'How is DAU trending over the last 30 days?',
    topicTags: ['liveops'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/dau'],
  },
  {
    id: 'wau-dau-ratio',
    text: 'Compare WAU and DAU over the last 30 days — how sticky is the player base?',
    topicTags: ['liveops'],
    categoryTags: ['compare', 'metric_explain'],
    targetCatalogIds: ['business_metrics/wau', 'business_metrics/dau'],
  },
  {
    id: 'total-online-time-trend',
    text: 'How has total online time (hrs) shifted over the past 30 days?',
    topicTags: ['liveops'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/total_online_time_hrs'],
  },
  // ---- Acquisition / Marketing — fast metrics ----
  {
    id: 'nru-by-channel',
    text: 'Which channels drove the most new registered users this month?',
    topicTags: ['user_acquisition'],
    categoryTags: ['compare', 'explore'],
    targetCatalogIds: ['business_metrics/nru'],
  },
  {
    id: 'installs-cpi-trend',
    text: 'How are installs and CPI trending this week vs last week?',
    topicTags: ['user_acquisition'],
    categoryTags: ['compare', 'metric_explain'],
    targetCatalogIds: ['business_metrics/installs', 'business_metrics/cpi'],
  },
  {
    id: 'roas-by-channel',
    text: 'Which acquisition channels have the best ROAS right now?',
    topicTags: ['user_acquisition'],
    categoryTags: ['compare', 'explore'],
    targetCatalogIds: ['business_metrics/roas'],
  },
  {
    id: 'marketing-cost-breakdown',
    text: 'How is marketing cost split across channels this month?',
    topicTags: ['user_acquisition'],
    categoryTags: ['explore', 'compare'],
    targetCatalogIds: ['business_metrics/cost'],
  },
  // ---- Retention — fast metric ----
  {
    id: 'paying-retention-trend',
    text: 'How has paying-user D7 retention (rp) changed across monthly cohorts?',
    topicTags: ['user_acquisition', 'monetization'],
    categoryTags: ['metric_explain', 'explore'],
    targetCatalogIds: ['business_metrics/rp'],
  },
  // ---- Economy (diamond flow) — fast metrics ----
  {
    id: 'diamond-spend-daily',
    text: 'Daily diamond spend events over the last 14 days',
    topicTags: ['liveops'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/diamond_spend_events'],
  },
  {
    id: 'diamond-net-delta-trend',
    text: 'Is diamond net delta trending positive or negative this week?',
    topicTags: ['liveops'],
    categoryTags: ['explore', 'diagnose'],
    targetCatalogIds: ['business_metrics/diamond_net_delta'],
  },
  {
    id: 'economy-spenders-count',
    text: 'How many unique economy spenders do we have per day this month?',
    topicTags: ['liveops', 'monetization'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/economy_spenders'],
  },
  // ---- Gacha / Lottery pulls — fast metrics ----
  {
    id: 'gacha-pulls-trend',
    text: 'How many gacha pulls per day over the last 30 days?',
    topicTags: ['liveops'],
    categoryTags: ['explore', 'metric_explain'],
    targetCatalogIds: ['business_metrics/gacha_pulls'],
  },
  {
    id: 'gacha-diamond-cost-by-banner',
    text: 'Rank every gacha banner by total diamond spend this month',
    topicTags: ['liveops', 'monetization'],
    categoryTags: ['compare', 'explore'],
    targetCatalogIds: ['business_metrics/gacha_diamond_cost'],
  },
  // ---- Onboarding / Tutorial — fast metrics ----
  {
    id: 'tutorial-completion-rate',
    text: 'What is the tutorial completion rate this month, and how has it trended?',
    topicTags: ['user_acquisition'],
    categoryTags: ['metric_explain', 'explore'],
    targetCatalogIds: ['business_metrics/tutorial_completion_rate'],
  },
  {
    id: 'tutorial-starters-vs-completions',
    text: 'Compare tutorial starters vs completions over the last 14 days',
    topicTags: ['user_acquisition'],
    categoryTags: ['compare', 'diagnose'],
    targetCatalogIds: ['business_metrics/tutorial_starters', 'business_metrics/tutorial_completions'],
  },
];

export const STARTER_CATEGORIES: ReadonlyArray<StarterCategory> = [
  'explore',
  'metric_explain',
  'compare',
  'diagnose',
];

export const STARTER_TOPICS: ReadonlyArray<StarterTopic> = [
  'liveops',
  'user_acquisition',
  'monetization',
];

/** Display labels for topic tags (chips + card footers). */
export const STARTER_TOPIC_LABELS: Record<StarterTopic, string> = {
  liveops: 'LiveOps',
  user_acquisition: 'User Acquisition',
  monetization: 'Monetization',
};

/**
 * Topic accent colors — semantic design tokens (src/theme/tokens.css), so
 * they adapt to dark mode for free. soft = pill/chip background, ink = text.
 */
export const STARTER_TOPIC_COLORS: Record<StarterTopic, { soft: string; ink: string }> = {
  liveops: { soft: 'var(--info-soft)', ink: 'var(--info-ink)' },
  user_acquisition: { soft: 'var(--success-soft)', ink: 'var(--success-ink)' },
  monetization: { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
};

/**
 * Cold-start threshold — must match chat-service config
 * `starterRankMinSessions`. Hardcoded here to avoid a runtime fetch just to
 * read a constant (the FE has no other reason to call chat-service config).
 */
export const STARTER_RANK_MIN_SESSIONS = 3;
