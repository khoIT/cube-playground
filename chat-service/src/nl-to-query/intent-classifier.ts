/**
 * Lightweight rule-based classifier that infers the shape of the user's
 * intent from phrase patterns. Output is one of:
 *   - leaderboard : "top spenders", "rank by revenue", "highest ARPU"
 *   - trend       : "trend of revenue", "daily ARPU", "over time"
 *   - comparison  : "iOS vs Android", "compare May vs June"
 *   - aggregate   : default — single number or grouped breakdown
 *
 * The classifier is intentionally conservative — every non-default rule
 * requires either a specific keyword OR a keyword paired with a context
 * hint to avoid false positives ("top of the funnel" must not flip to
 * leaderboard). Bilingual (English + Vietnamese).
 */

import type { QueryIntent, ScoredSlot } from './types.js';

const LEADERBOARD_RE = /\b(top|highest|lowest|bottom|rank(ed|s|ing)?|leaderboard|biggest|smallest|nhiều\s*nhất|cao\s*nhất|thấp\s*nhất|xếp\s*hạng)\b/iu;

const TREND_RE = /\b(trend|over\s*time|daily|weekly|monthly|hourly|by\s*day|by\s*week|by\s*month|theo\s*ngày|theo\s*tuần|theo\s*tháng|xu\s*hướng)\b/iu;

const COMPARISON_RE = /\b(vs\.?|versus|compared?\s*to|so\s*với|so\s*sánh)\b/iu;

const LIMIT_HINT_RE = /\b(?:top|highest|lowest|bottom|nhiều\s*nhất|cao\s*nhất|thấp\s*nhất)\s*(\d+)\b/iu;

const FALSE_POSITIVES_RE = /\b(top\s*of\s*(?:the\s*)?funnel|top\s*level|đầu\s*phễu)\b/iu;

export interface IntentResult {
  slot: ScoredSlot<QueryIntent>;
  limit?: number;
}

export function classifyIntent(message: string): IntentResult {
  if (FALSE_POSITIVES_RE.test(message)) {
    return aggregate();
  }
  if (COMPARISON_RE.test(message)) {
    return scored('comparison', 0.9, message, COMPARISON_RE);
  }
  if (LEADERBOARD_RE.test(message)) {
    const limitMatch = LIMIT_HINT_RE.exec(message);
    const limit = limitMatch ? clampLimit(parseInt(limitMatch[1], 10)) : undefined;
    return { ...scored('leaderboard', 0.92, message, LEADERBOARD_RE), limit };
  }
  if (TREND_RE.test(message)) {
    return scored('trend', 0.88, message, TREND_RE);
  }
  return aggregate();
}

function aggregate(): IntentResult {
  return { slot: { value: 'aggregate', confidence: 0.6 } };
}

function scored(value: QueryIntent, confidence: number, message: string, re: RegExp): IntentResult {
  const m = re.exec(message);
  if (!m) return { slot: { value, confidence } };
  return {
    slot: {
      value,
      confidence,
      alias: m[0],
      span: [m.index, m.index + m[0].length] as [number, number],
    },
  };
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 10;
  if (n > 100) return 100;
  return n;
}
