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

import { getDefaultWorkspace, resolveWorkspace } from './workspaces-config-loader.js';
import { gamePrefixFor } from './prefix-meta-filter.js';

export function resolveGamePrefix(gameId: string | null): string | null {
  return gamePrefixFor(getDefaultWorkspace(), gameId);
}

/**
 * Workspace-scoped prefix resolution for background jobs that know the
 * artifact's own workspace (e.g. `segment.workspace`). The naming model is a
 * property of the workspace the artifact lives in, NOT the deployment default:
 * a segment created on a game_id workspace must resolve prefix=null even when
 * the default workspace is prefix-model, or its logical cube/identity names get
 * physicalized against a cube that doesn't carry the prefix and the query fails.
 *
 * Falls back to the default workspace when the id is unknown/empty, so callers
 * with no workspace context behave exactly like resolveGamePrefix.
 */
export function resolveGamePrefixForWorkspace(
  workspaceId: string | null,
  gameId: string | null,
): string | null {
  const workspace = resolveWorkspace(workspaceId) ?? getDefaultWorkspace();
  return gamePrefixFor(workspace, gameId);
}
