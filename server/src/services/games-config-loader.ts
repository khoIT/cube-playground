/**
 * Single source of truth for `gds.config.json` (the game registry).
 * Cached in-process; both /api/playground/games and /api/playground/cube-token
 * consume it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface GameDef {
  id: string;
  name: string;
  mark?: string;
  color?: string;
}

export interface GamesConfig {
  defaultGameId: string;
  games: GameDef[];
}

const FALLBACK: GamesConfig = {
  defaultGameId: 'ptg',
  games: [{ id: 'ptg', name: 'Play Together', mark: 'PT' }],
};

let cached: GamesConfig | null = null;

export function loadGamesConfig(): GamesConfig {
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

export function isKnownGame(gameId: string): boolean {
  return loadGamesConfig().games.some((g) => g.id === gameId);
}

/** Test-only reset to clear the cache between cases. */
export function __resetGamesConfigCache(): void {
  cached = null;
}
