/**
 * Intent router — maps a user message to a skill name via keyword heuristic.
 *
 * Priority order:
 *   1. Slash prefix (/explore, /metric, /metric_explain) → force-route, confidence 1.
 *   2. Keyword scoring (each keyword weighted by its character length).
 *   3. Tie between skills → autoRoute false (LLM chooses from master prompt).
 *   4. No match → default to 'explore', confidence 0, autoRoute false.
 */

export interface IntentResult {
  skill: string;
  confidence: number;
  autoRoute: boolean;
}

// Slash aliases accepted at message start (case-insensitive).
const SLASH_ALIASES: Record<string, string> = {
  '/explore': 'explore',
  '/metric': 'metric_explain',
  '/metric_explain': 'metric_explain',
};

// Keywords per skill. Multi-word phrases score higher due to length weighting.
const KEYWORDS: Record<string, string[]> = {
  explore: [
    'show', 'plot', 'chart', 'count', 'sum', 'average', 'avg',
    'breakdown', 'top', 'list', 'by', 'last',
    'hôm', 'ngày', 'biểu đồ', 'hiển thị', 'theo', 'tuần qua',
  ],
  metric_explain: [
    'what is', 'define', 'formula', 'mean', 'meaning',
    'công thức', 'định nghĩa', 'là gì', 'giải thích',
  ],
};

// Fixed denominator for confidence normalisation.
// Reflects a realistic single-message score (one or two keyword hits).
// A message scoring ≥ 6 chars (e.g. one 6-char keyword) yields confidence ≥ 0.6 → autoRoute.
const CONFIDENCE_DENOM = 10;

export function routeIntent(message: string): IntentResult {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Slash prefix always wins.
  for (const [prefix, skill] of Object.entries(SLASH_ALIASES)) {
    if (lower.startsWith(prefix + ' ') || lower === prefix) {
      return { skill, confidence: 1, autoRoute: true };
    }
  }

  // Score each skill by sum of matched keyword lengths.
  const scores: Array<{ skill: string; score: number }> = [];
  for (const [skill, keywords] of Object.entries(KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += kw.length;
    }
    if (score > 0) scores.push({ skill, score });
  }

  if (scores.length === 0) {
    return { skill: 'explore', confidence: 0, autoRoute: false };
  }

  scores.sort((a, b) => b.score - a.score);

  // Tie → surface top candidate but disable auto-routing.
  if (scores.length > 1 && scores[0].score === scores[1].score) {
    return { skill: scores[0].skill, confidence: 0.5, autoRoute: false };
  }

  const { skill, score } = scores[0];
  const confidence = Math.min(1, score / CONFIDENCE_DENOM);

  return { skill, confidence, autoRoute: confidence >= 0.6 };
}
