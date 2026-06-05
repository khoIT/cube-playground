/**
 * Pregenerated starter-question seed — seed/starter-questions-seed.json.
 *
 * Lives in `chat-service/seed/` (NOT `runtime/` — that dir is writable scratch,
 * excluded by .dockerignore, so anything in it silently vanishes from the prod
 * image; the Dockerfile chat-service stage COPYs `seed/` explicitly).
 *
 * The seed file is produced ONCE by `npm run starters:pregenerate` (LLM refine
 * with data-shape + time-coverage context) and checked into git, so every
 * environment that ships this build serves byte-identical starter questions.
 * A game present in the seed bypasses the dynamic template→refine pipeline
 * entirely: no meta_hash invalidation, no per-environment LLM drift.
 *
 * Lazy-loaded and cached; a missing or corrupt file degrades to "no seed"
 * (dynamic pipeline takes over) — never throws into a request path.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StarterQuestion } from './starter-questions-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '..', '..', 'seed', 'starter-questions-seed.json');

export interface StarterSeedEntry {
  questions: StarterQuestion[];
  /** Latest date with data per probed time dimension at generation time. */
  coverage?: Record<string, string>;
}

export interface StarterSeedFile {
  /** Bump (or regenerate) to roll new questions out — doubles as the row meta_hash. */
  version: string;
  generatedAt: number;
  /** Workspace the generation script ran against (provenance only). */
  workspaceGenerated: string;
  games: Record<string, StarterSeedEntry>;
}

export interface StarterSeedHit {
  version: string;
  generatedAt: number;
  entry: StarterSeedEntry;
}

let cache: StarterSeedFile | null | undefined;

function loadSeedFile(): StarterSeedFile | null {
  if (cache !== undefined) return cache;
  cache = null;
  try {
    if (!existsSync(SEED_PATH)) return cache;
    const parsed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as StarterSeedFile;
    if (
      typeof parsed?.version === 'string' &&
      parsed.games &&
      typeof parsed.games === 'object'
    ) {
      cache = parsed;
    }
  } catch {
    // Corrupt seed → treat as absent; the dynamic pipeline still works.
    cache = null;
  }
  return cache;
}

/** Seed lookup for a game. Null when the file or the game entry is absent/empty. */
export function getSeedEntry(gameId: string): StarterSeedHit | null {
  const file = loadSeedFile();
  if (!file) return null;
  const entry = file.games[gameId];
  if (!entry || !Array.isArray(entry.questions) || entry.questions.length === 0) return null;
  return { version: file.version, generatedAt: file.generatedAt, entry };
}

/** Test hook — drop the cached file so a test can swap fixtures. */
export function __resetStarterSeedCache(): void {
  cache = undefined;
}

export { SEED_PATH as STARTER_SEED_PATH };
