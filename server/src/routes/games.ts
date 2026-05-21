/**
 * Game registry endpoint. Reads gds.config.json at server cwd (repo root) and
 * exposes it under /api/playground/games. Public — no secrets in config.
 */

import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface GameDef {
  id: string;
  name: string;
  mark?: string;
  color?: string;
}

interface GamesConfig {
  defaultGameId: string;
  games: GameDef[];
}

const FALLBACK: GamesConfig = {
  defaultGameId: 'ptg',
  games: [{ id: 'ptg', name: 'Play Together', mark: 'PT' }],
};

let cached: GamesConfig | null = null;

function loadConfig(): GamesConfig {
  if (cached) return cached;
  const path = join(process.cwd(), 'gds.config.json');
  if (!existsSync(path)) {
    cached = FALLBACK;
    return cached;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as GamesConfig;
    if (!parsed.defaultGameId || !Array.isArray(parsed.games)) {
      cached = FALLBACK;
    } else {
      cached = parsed;
    }
  } catch {
    cached = FALLBACK;
  }
  return cached;
}

export default async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/playground/games', async () => loadConfig());
}
