/**
 * inferOutputHint — predict the SHAPE of a starter question's answer
 * (ranking / trend / comparison / funnel / breakdown) from its text and
 * intent categories. Pure heuristic, no fetch: the hint renders as a small
 * icon on the starter card so stakeholders can anticipate the payoff
 * (a ranked table vs a trend line vs a side-by-side) before clicking.
 */
import type { StarterCategory, StarterQuestion } from './starter-questions';

export type StarterOutputHint =
  | 'ranking'
  | 'trend'
  | 'comparison'
  | 'funnel'
  | 'breakdown';

export const OUTPUT_HINT_LABELS: Record<StarterOutputHint, string> = {
  ranking: 'Ranked list',
  trend: 'Trend over time',
  comparison: 'Side-by-side comparison',
  funnel: 'Funnel / step analysis',
  breakdown: 'Distribution breakdown',
};

/** Text patterns checked in priority order — first hit wins. */
const TEXT_RULES: ReadonlyArray<{ hint: StarterOutputHint; re: RegExp }> = [
  // Funnel beats everything: step/drop-off wording is unambiguous. Bare
  // "conversion" is NOT a funnel signal — "conversion rate trended" is a
  // trend; only "convert to X" / "conversion funnel" imply stage analysis.
  { hint: 'funnel', re: /funnel|drop-?off|tutorial step|convert(?:s|ed)? to|conversion funnel/ },
  // Distribution wording before ranking — "what share of ranked matches"
  // must not trip the \brank\b rule below.
  { hint: 'breakdown', re: /\bshare of\b|distribution|break ?down|\bmix\b|pareto|split across/ },
  { hint: 'comparison', re: /\bcompare\b|\bversus\b|\bvs\.?\b|side-by-side|better than|head-to-head/ },
  { hint: 'trend', re: /\btrend|over the last|how has|shift(?:ed|ing)|month over month|improving|getting better/ },
  { hint: 'ranking', re: /\brank\b|rank every|top \d+|\bmost\b|highest|lowest|\bbest\b|\bworst\b/ },
];

/** Fallback when no text rule fires — derive from the intent category. */
const CATEGORY_FALLBACK: Record<StarterCategory, StarterOutputHint> = {
  compare: 'comparison',
  metric_explain: 'trend',
  explore: 'ranking',
  diagnose: 'breakdown',
};

export function inferOutputHint(
  question: Pick<StarterQuestion, 'text' | 'categoryTags'>,
): StarterOutputHint {
  const text = question.text.toLowerCase();
  for (const rule of TEXT_RULES) {
    if (rule.re.test(text)) return rule.hint;
  }
  const category = question.categoryTags[0];
  return (category && CATEGORY_FALLBACK[category]) || 'breakdown';
}
