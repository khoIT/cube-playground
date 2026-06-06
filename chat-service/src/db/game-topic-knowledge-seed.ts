/**
 * Per-game topic knowledge seed — seed/game-topic-knowledge-seed.json.
 *
 * A LONGER curated layer than the starter-question seed: per (game, topic) a
 * tier-1-verified question bank (composable + returns data) plus the common
 * metrics the game's current data model can serve, each with a one-line
 * "why it matters". Produced by `npm run knowledge:pregenerate` and checked
 * into git (same placement rules as the starter seed — `seed/`, NOT
 * `runtime/`, so the Docker image ships it).
 *
 * Consumers:
 *   - get_topic_knowledge chat tool — grounds generic asks like "what should
 *     I know about revenue / liveops for this game" in suggestions the data
 *     model is proven to answer.
 *   - (future) FE suggestion surfaces beyond the 6-per-topic starter chips.
 *
 * Lazy-loaded and cached; missing/corrupt file degrades to "no knowledge"
 * (the tool reports that honestly) — never throws into a request path.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '..', '..', 'seed', 'game-topic-knowledge-seed.json');

export const KNOWLEDGE_TOPICS = ['liveops', 'user_acquisition', 'monetization'] as const;
export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number];

export interface KnowledgeQuestion {
  id: string;
  text: string;
  /** basic = cross-game KPI cubes; advanced = game-specific event tables. */
  depth?: 'basic' | 'advanced';
  /** Real `cube.member` names from this game's meta — tier-1 verified. */
  targetCatalogIds: string[];
}

export interface KnowledgeMetric {
  /** Real `cube.measure` name from this game's meta. */
  member: string;
  /** Human title (from meta or LLM-normalised). */
  title: string;
  /** One line on why a publisher should watch this metric. */
  why: string;
}

export interface TopicKnowledge {
  questions: KnowledgeQuestion[];
  metrics: KnowledgeMetric[];
}

export interface KnowledgeSeedEntry {
  topics: Record<KnowledgeTopic, TopicKnowledge>;
  /** Latest date with data per probed time dimension at generation time. */
  coverage?: Record<string, string>;
  generatedAt: number;
}

export interface KnowledgeSeedFile {
  version: string;
  generatedAt: number;
  workspaceGenerated: string;
  games: Record<string, KnowledgeSeedEntry>;
}

let cache: KnowledgeSeedFile | null | undefined;

function loadSeedFile(): KnowledgeSeedFile | null {
  if (cache !== undefined) return cache;
  cache = null;
  try {
    if (!existsSync(SEED_PATH)) return cache;
    const parsed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as KnowledgeSeedFile;
    if (typeof parsed?.version === 'string' && parsed.games && typeof parsed.games === 'object') {
      cache = parsed;
    }
  } catch {
    cache = null;
  }
  return cache;
}

/** Knowledge lookup for a game. Null when the file or game entry is absent. */
export function getKnowledgeEntry(gameId: string): KnowledgeSeedEntry | null {
  const file = loadSeedFile();
  if (!file) return null;
  return file.games[gameId] ?? null;
}

/** Test hook — drop the cached file so a test can swap fixtures. */
export function __resetKnowledgeSeedCache(): void {
  cache = undefined;
}

export { SEED_PATH as KNOWLEDGE_SEED_PATH };
