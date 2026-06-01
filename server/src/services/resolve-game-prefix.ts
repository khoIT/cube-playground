/**
 * Resolve the Cube cube-name prefix for a game in server-side / cron contexts
 * that have a gameId but no request-scoped workspace (e.g. segment refresh,
 * LiveOps refresh, anomaly detector).
 *
 * Uses the default workspace from the registry — a single deployment serves one
 * default workspace (local = game_id, prod = the prefix workspace), so the
 * default is the correct context for background jobs. Returns null on game_id
 * workspaces, no game, or unmapped game → every consumer's resolver call becomes
 * a no-op there.
 */

import { getDefaultWorkspace } from './workspaces-config-loader.js';
import { gamePrefixFor } from './prefix-meta-filter.js';

export function resolveGamePrefix(gameId: string | null): string | null {
  return gamePrefixFor(getDefaultWorkspace(), gameId);
}
