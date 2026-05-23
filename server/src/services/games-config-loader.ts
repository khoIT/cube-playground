/**
 * Single source of truth for `gds.config.json` (the game registry).
 * Cached in-process; both /api/playground/games and /api/playground/cube-token
 * consume it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const CONFIG_FILENAME = 'gds.config.json';

let cached: GamesConfig | null = null;

// Resolve `gds.config.json` regardless of where the server was started from
// (cwd may be repo root, server/ via `npm --prefix server run dev`, or test
// tmp dirs that chdir). Order: explicit env override → cwd (test compat) →
// walk up from this module until found or filesystem root.
function resolveConfigPath(): string | null {
  const envPath = process.env.GDS_CONFIG_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const cwdPath = join(process.cwd(), CONFIG_FILENAME);
  if (existsSync(cwdPath)) return cwdPath;

  let dir = dirname(fileURLToPath(import.meta.url));
  const { root } = parse(dir);
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

export function loadGamesConfig(): GamesConfig {
  if (cached) return cached;
  const path = resolveConfigPath();
  if (!path) {
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
