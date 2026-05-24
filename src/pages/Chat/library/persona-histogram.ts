/**
 * Topic-histogram ranking for starter library (phase-01).
 *
 * Input: list of recent intent-router categories observed for this user
 * (from `chat_audit.kind='intent_routed'`). Cold-start (sessions < min) ⇒
 * uniform weights; otherwise cosine of histogram × starter categoryTags.
 *
 * Pure function (no IO). The fetch happens in the page hook; this module
 * just ranks.
 */

import type {
  StarterCategory,
  StarterQuestion,
} from './starter-questions';
import { STARTER_CATEGORIES } from './starter-questions';

export interface RankedStarter {
  starter: StarterQuestion;
  score: number;
}

/** Build a unit-norm histogram vector across STARTER_CATEGORIES. */
function categoriesToVector(
  categories: ReadonlyArray<StarterCategory>,
): number[] {
  const counts = new Array(STARTER_CATEGORIES.length).fill(0) as number[];
  for (const cat of categories) {
    const idx = STARTER_CATEGORIES.indexOf(cat);
    if (idx >= 0) counts[idx] += 1;
  }
  const norm = Math.sqrt(counts.reduce((a, b) => a + b * b, 0));
  if (norm === 0) return counts;
  return counts.map((c) => c / norm);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both are unit-norm
}

export interface RankStartersInput {
  starters: ReadonlyArray<StarterQuestion>;
  /** Recent intent-router categories (last ~20 sessions). */
  recentCategories: ReadonlyArray<StarterCategory>;
  /** Sessions seen by this user (drives cold-start gate). */
  sessionCount: number;
  /** Cold-start threshold from chat-service config (decision C5). */
  minSessions: number;
}

/**
 * Returns starters in rank order. Cold-start ⇒ original order (uniform).
 * Otherwise sorts by descending cosine score with stable tie-break on id.
 */
export function rankStarters(input: RankStartersInput): RankedStarter[] {
  const { starters, recentCategories, sessionCount, minSessions } = input;
  if (sessionCount < minSessions || recentCategories.length === 0) {
    return starters.map((s) => ({ starter: s, score: 0 }));
  }
  const userVec = categoriesToVector(recentCategories);
  const ranked = starters.map((s) => {
    const starterVec = categoriesToVector(s.categoryTags);
    return { starter: s, score: cosine(userVec, starterVec) };
  });
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.starter.id.localeCompare(b.starter.id);
  });
  return ranked;
}
