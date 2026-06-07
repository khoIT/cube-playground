/**
 * Heuristic for analysis questions that legitimately need more than the
 * default per-turn budget.
 *
 * Funnel / journey / milestone questions fan out into many sequential cube
 * queries (one per step, often with guard-rail retries when a range is
 * unbounded or too wide), so they routinely exhaust chatTurnTimeoutMs while
 * still making honest progress. Rather than raising the budget for every
 * turn, double it — same multiplier research mode uses — only for this class.
 *
 * Deliberately narrow: a false positive merely lets a turn run longer before
 * the timeout abort + salvage path, never changes the answer.
 */

const HEAVY_ANALYSIS_PATTERNS: RegExp[] = [
  /\bfunnels?\b/i,
  /\buser journeys?\b/i,
  /\bmilestones?\b/i,
  // "install → login → purchase"-style explicit step chains
  /\b(?:install|register|login|signup)\b.{0,40}\b(?:to|→|->)\b.{0,40}\b(?:purchase|recharge|payer|conversion|milestone)/i,
];

/** True when the question matches a known heavy-analysis shape. */
export function isHeavyAnalysisQuestion(message: string): boolean {
  return HEAVY_ANALYSIS_PATTERNS.some((re) => re.test(message));
}
