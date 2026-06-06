/**
 * Tool: get_topic_knowledge
 * Serves the pregenerated per-game topic knowledge bank (curated questions +
 * common metrics the game's CURRENT data model is proven to answer, tier-1
 * verified at generation time). The grounding source for generic asks like
 * "what should I know about revenue / liveops for this game" — suggest from
 * this bank instead of inventing questions that may not be answerable.
 */

import { z } from 'zod';
import {
  getKnowledgeEntry,
  KNOWLEDGE_TOPICS,
  type KnowledgeTopic,
} from '../db/game-topic-knowledge-seed.js';
import type { ToolContext } from '../types.js';

export const name = 'get_topic_knowledge';
export const description =
  'Get the curated knowledge bank for the active game: verified analytics questions and the common ' +
  'metrics the current data model can serve, grouped by publishing topic (liveops / user_acquisition / ' +
  'monetization). Call this FIRST when the user asks a GENERIC orientation question — "what should I ' +
  'know about revenue?", "give me an overview of liveops", "what can I ask about this game?" — and ' +
  'build your answer/suggestions from the returned bank (every entry is verified answerable). ' +
  'Omit `topic` to get all three topics.';

export const inputSchema = {
  /** One of liveops | user_acquisition | monetization; omit for all topics. */
  topic: z.enum(KNOWLEDGE_TOPICS).optional(),
};

export async function handler(
  args: { topic?: KnowledgeTopic },
  ctx: ToolContext,
): Promise<unknown> {
  const entry = getKnowledgeEntry(ctx.gameId);
  if (!entry) {
    return {
      found: false,
      note:
        `No pregenerated knowledge bank for game "${ctx.gameId}". ` +
        'Fall back to get_cube_meta + list_business_metrics to orient the user.',
    };
  }
  const topics = args.topic ? [args.topic] : [...KNOWLEDGE_TOPICS];
  const out: Record<string, unknown> = {};
  for (const t of topics) {
    const k = entry.topics[t];
    if (k) out[t] = k;
  }
  return {
    found: true,
    game: ctx.gameId,
    coverage: entry.coverage ?? {},
    topics: out,
  };
}
