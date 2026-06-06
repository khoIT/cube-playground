/**
 * POST /debug/reload-starter-seed
 *
 * Drops the in-process starter-question seed cache so the next lookup
 * re-reads seed/starter-questions-seed.json from disk. Used by the
 * pregenerate→verify workflow: it writes a PROVISIONAL seed, reloads, runs a
 * real chat turn per candidate question (the clicked-chip pass-through only
 * fires for questions present in the seed), then writes the final seed and
 * reloads again. Harmless to call at any time — it only re-reads a file.
 *
 * Returns the seed version + game list now visible to the process (null
 * version when the file is absent/corrupt).
 */

import type { FastifyPluginAsync } from 'fastify';
import { __resetStarterSeedCache, getSeedEntry } from '../db/starter-questions-seed.js';
import { readFileSync, existsSync } from 'node:fs';
import { STARTER_SEED_PATH } from '../db/starter-questions-seed.js';

const debugReloadStarterSeedRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/debug/reload-starter-seed', async (_req, reply) => {
    __resetStarterSeedCache();
    // Peek at the file directly for the response payload — getSeedEntry only
    // exposes per-game lookups, and we want version + games for confirmation.
    let version: string | null = null;
    let games: string[] = [];
    try {
      if (existsSync(STARTER_SEED_PATH)) {
        const parsed = JSON.parse(readFileSync(STARTER_SEED_PATH, 'utf8')) as {
          version?: string;
          games?: Record<string, unknown>;
        };
        version = typeof parsed.version === 'string' ? parsed.version : null;
        games = parsed.games ? Object.keys(parsed.games) : [];
      }
    } catch {
      // Corrupt file reads as "no seed" — same degradation as the serve path.
    }
    // Touch the lookup path so the cache is warm again after the reset.
    if (games.length > 0) getSeedEntry(games[0]);
    return reply.send({ reloaded: true, version, games });
  });
};

export default debugReloadStarterSeedRoutes;
