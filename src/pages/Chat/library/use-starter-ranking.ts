/**
 * useStarterRanking — fetches recent intent histogram and ranks the starter
 * library accordingly. Returns the starters in display order plus the user
 * session count (used by the page to decide whether to show all-unranked).
 */
import { useEffect, useMemo, useState } from 'react';
import { getOwnerId } from '../../../api/chat-owner-id';
import { rankStarters } from './persona-histogram';
import {
  STARTER_CATEGORIES,
  STARTER_QUESTIONS,
  type StarterCategory,
  type StarterQuestion,
} from './starter-questions';

/**
 * Map intent-router skill names to starter categoryTags. Skill names already
 * match category names today; this indirection keeps the rename surface
 * narrow if intent-router skills diverge from starter categories later.
 */
const SKILL_TO_CATEGORY: Record<string, StarterCategory> = {
  explore: 'explore',
  metric_explain: 'metric_explain',
  compare: 'compare',
  diagnose: 'diagnose',
};

interface IntentRow {
  skill: string;
  at: number;
}

export interface UseStarterRankingResult {
  ranked: ReadonlyArray<StarterQuestion>;
  /** Number of distinct sessions an intent was logged against. */
  intentObservations: number;
}

export function useStarterRanking(
  /** Cold-start threshold from chat-service config (decision C5). */
  minSessions: number,
  /** Persona filter — narrows the pool BEFORE ranking. */
  filter: (s: StarterQuestion) => boolean,
): UseStarterRankingResult {
  const [intents, setIntents] = useState<IntentRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat/audit/intents?limit=20', {
      headers: { Accept: 'application/json', 'X-Owner-Id': getOwnerId() },
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { intents?: IntentRow[] };
        if (!cancelled) setIntents(data.intents ?? []);
      })
      .catch(() => {
        // soft fail — cold-start path renders everything
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const recentCategories: StarterCategory[] = intents
      .map((r) => SKILL_TO_CATEGORY[r.skill])
      .filter((c): c is StarterCategory => !!c && STARTER_CATEGORIES.includes(c));
    const pool = STARTER_QUESTIONS.filter(filter);
    const ranked = rankStarters({
      starters: pool,
      recentCategories,
      sessionCount: intents.length,
      minSessions,
    });
    return {
      ranked: ranked.map((r) => r.starter),
      intentObservations: intents.length,
    };
  }, [intents, minSessions, filter]);
}
