/**
 * Intent router — maps a user message to a skill name via keyword heuristic.
 *
 * Priority order:
 *   1. Slash prefix (/explore, /metric, /metric_explain) → force-route, confidence 1.
 *   2. Segment-creation intent pattern → force-route to 'segment'. A verb+noun
 *      regex tolerates the articles ("a", "an", "the", "me a") and connectors
 *      ("that as a") that a flat keyword list misses — "create a segment",
 *      "save that as a cohort", "turn this into an audience" all match.
 *   3. Keyword scoring (each keyword weighted by its character length).
 *   4. Tie between skills → autoRoute false (LLM chooses from master prompt).
 *   5. No match → default to 'explore', confidence 0, autoRoute false.
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
  '/compare': 'compare',
  '/diagnose': 'diagnose',
  '/advise': 'advise',
  '/segment': 'segment',
};

// Keywords per skill. Multi-word phrases score higher due to length weighting.
const KEYWORDS: Record<string, string[]> = {
  explore: [
    'show', 'plot', 'chart', 'count', 'sum', 'average', 'avg',
    'breakdown', 'top', 'list', 'by', 'last',
    'hôm', 'ngày', 'biểu đồ', 'hiển thị', 'theo', 'tuần qua',
    'doanh thu', 'người dùng', 'paying user', 'trả phí',
    'theo ngày', 'theo tuần', 'theo tháng', 'trong q', 'quý',
    'tăng trưởng', 'số lượng', 'tổng',
  ],
  metric_explain: [
    'what is', 'define', 'formula', 'mean', 'meaning',
    'công thức', 'định nghĩa', 'là gì', 'giải thích',
  ],
  compare: [
    'compare', 'vs', 'versus', 'against', 'between',
    'so với', 'hơn', 'kém',
    'so sánh', 'đối chiếu', 'chênh lệch',
  ],
  diagnose: [
    'why', 'drop', 'spike', 'anomaly', 'root cause',
    'fell', 'rose', 'surge',
    'tại sao', 'giảm', 'tăng đột',
    'nguyên nhân', 'vì sao', 'vì lý do gì', 'sụt giảm', 'tăng vọt',
  ],
  // Prescriptive door: "what should I DO" phrasing. Multi-word action phrases
  // dominate the length-weighted scorer so these out-rank a stray short word and
  // do not collide with explore's descriptive verbs (show/plot/by/…).
  advise: [
    'what should i', 'how should i', 'how do i improve', 'what to do',
    'should we focus', 'should we prioritize', 'next steps', 'next step',
    'recommendation', 'recommend', 'suggestion', 'suggest', 'focus on',
    'priority', 'grow', 'boost', 'increase', 'mitigate', 'fix',
    'nên làm gì', 'làm sao để', 'làm thế nào để', 'đề xuất', 'gợi ý',
    'ưu tiên', 'tập trung vào', 'cải thiện',
  ],
  segment: [
    // EN — explicit segment / audience / cohort creation intent
    'create segment', 'save segment', 'build segment',
    'create audience', 'build audience', 'save audience',
    'create cohort', 'build cohort', 'save cohort',
    'save as segment', 'save that as segment', 'save this as segment',
    'turn into segment', 'make a segment',
    // VN — tạo / lưu + phân khúc / nhóm / đối tượng
    'tạo phân khúc', 'lưu phân khúc',
    'tạo nhóm', 'lưu nhóm',
    'tạo đối tượng', 'lưu đối tượng',
  ],
};

// Segment-creation intent. A flat keyword list cannot catch the article and
// connector words a user naturally types ("create A segment", "save that AS A
// cohort"), so detect the verb→noun shape directly. The bounded gap keeps it
// from firing across unrelated clauses (e.g. "create a chart … by segment").
// EN verbs that introduce a new audience; VN handled by the keyword list below.
const SEGMENT_INTENT_EN =
  /\b(create|creating|build|building|save|saving|make|making|turn|turning|convert|generate)\b[\s\w]{0,25}?\b(segment|segments|audience|audiences|cohort|cohorts)\b/;

// Segment-EDIT intent — "add/remove/change/edit/modify … to/from … <segment>".
// Routes to the same 'segment' skill, which branches edit vs create on the verb.
// Two shapes: a mutate verb near the noun ("edit my Whales segment"), or
// add/remove with a to/from connector landing on the noun ("add VN to the … cohort").
// `[^\n]` (not `[\s\w]`) in the gaps tolerates the punctuation users type in
// predicates — "add country=VN to my Whales segment", "edit my high-spenders
// audience". Bounded length keeps it from spanning unrelated clauses.
const SEGMENT_EDIT_INTENT_EN =
  /\b(edit|editing|modify|modifying|change|changing|update|updating|adjust|rename|narrow|widen|tighten|loosen)\b[^\n]{0,30}?\b(segment|segments|audience|audiences|cohort|cohorts)\b|\b(add|adding|remove|removing|drop|dropping|exclude|include)\b[^\n]{0,40}?\b(to|from|into)\b[^\n]{0,30}?\b(segment|segments|audience|audiences|cohort|cohorts)\b/;

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

  // Segment create/edit intent force-routes before keyword scoring so a stray
  // "between" / "compare" / "add" word in the same sentence cannot steal the
  // route. Both shapes land on the 'segment' skill, which branches internally.
  if (SEGMENT_INTENT_EN.test(lower) || SEGMENT_EDIT_INTENT_EN.test(lower)) {
    return { skill: 'segment', confidence: 0.9, autoRoute: true };
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
