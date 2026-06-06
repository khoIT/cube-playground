/**
 * Resolve the identity (uid) dimension for a cube. Manual mapping in
 * `cube_identity_map` wins; otherwise fall back to the high-confidence
 * auto-suggester so a "revert to auto" toggle in Settings doesn't strand
 * downstream consumers. Used by both the refresh job and the live preview
 * so their count methodologies stay in lock-step.
 */

import { getDb } from '../db/sqlite.js';
import { suggestIdentities } from './identity-suggester.js';
import { resolveGamePrefixForWorkspace } from './resolve-game-prefix.js';
import { logicalCubeAcross } from './cube-member-resolver.js';
import { resolveWorkspace, getDefaultWorkspace } from './workspaces-config-loader.js';
import { resolveCubeTokenForWorkspace } from './resolve-cube-token.js';
import { loadGamesConfig } from './games-config-loader.js';
import type { WorkspaceCtx } from './cube-client.js';

/**
 * Floor of what the suggester can emit with a non-null field: join-probe
 * inheritance reports 0.7 (one hop removed from a direct pattern match,
 * which reports 0.8–0.95). The Build page accepts ANY non-null suggestion
 * when a segment is created, so the refresh job must accept the same set —
 * a stricter floor here means segments create fine, then break on refresh.
 */
const AUTO_SUGGEST_MIN_CONFIDENCE = 0.7;

/**
 * Build the schema-introspection Cube ctx for a (workspace, game) pair —
 * service principal, never a user email — mirroring the route-side
 * `introspectionCtx`. Without this ctx the suggester introspects the DEFAULT
 * game's /meta, where per-game cubes (cfm_vn's etl_*) simply don't exist, so
 * background jobs (refresh-segment) would mark such segments broken even
 * though the Build page resolved an identity for them just fine.
 *
 * Returns undefined when neither a workspace nor a game is known, preserving
 * the legacy ctx-less path for callers like preview-service.
 */
function buildIntrospectionCtx(
  workspaceId: string | null,
  gameId: string | null,
): WorkspaceCtx | undefined {
  try {
    const workspace = resolveWorkspace(workspaceId) ?? (gameId ? getDefaultWorkspace() : null);
    if (!workspace) return undefined;
    let game = gameId;
    // A strict multi-tenant cube rejects game-less tokens ("Missing game
    // claim") — fall back to the default game, same as the route-side ctx.
    if (!game && workspace.gameModel === 'game_id') {
      try {
        game = loadGamesConfig().defaultGameId || null;
      } catch {
        /* config unreadable — introspect game-less */
      }
    }
    const { token } = resolveCubeTokenForWorkspace(workspace, game);
    return { cubeApiUrl: workspace.cubeApiUrl, token };
  } catch {
    return undefined; // fall back to the legacy ctx-less suggester
  }
}

export interface IdentityResolutionOptions {
  /**
   * The artifact's own workspace id (e.g. `segment.workspace`). The prefix is
   * a property of THIS workspace, not the deployment default — passing it keeps
   * a game_id-workspace segment from being physicalized against the default
   * prefix workspace. Omit (or pass null) to fall back to the default workspace.
   */
  workspaceId?: string | null;
}

/**
 * Resolve the identity (uid) dimension for a cube. Accepts an optional gameId
 * so background jobs (refresh-segment) can pass the segment's game context, and
 * an optional workspaceId so the prefix is derived from the segment's OWN
 * workspace rather than the global default.
 *
 * Persisted overrides are stored in LOGICAL (prefix-stripped) space by the PUT
 * handler. When a physical cube name is passed (`ballistar_mf_users`) on a
 * prefix workspace, we derive the prefix and strip it before looking up the DB,
 * then physicalize the stored field back before returning. On game_id
 * workspaces (prefix null) the helpers are all no-ops and behavior is
 * byte-for-byte unchanged.
 */
export async function resolveIdentityField(
  cube: string,
  gameId?: string | null,
  opts?: IdentityResolutionOptions,
): Promise<string | null> {
  const prefix = resolveGamePrefixForWorkspace(opts?.workspaceId ?? null, gameId ?? null);
  // Normalize the incoming cube to logical space to match how overrides are stored.
  const logicalKey = prefix ? logicalCubeAcross(cube, [prefix]) : cube;

  const db = getDb();
  const row = db
    .prepare('SELECT identity_field FROM cube_identity_map WHERE cube = ?')
    .get(logicalKey) as { identity_field: string } | undefined;
  if (row?.identity_field) {
    // Re-physicalize the stored logical field for the caller that needs the
    // fully-qualified physical member name (e.g. `ballistar_mf_users.user_id`).
    if (prefix && !row.identity_field.startsWith(`${prefix}_`)) {
      return `${prefix}_${row.identity_field}`;
    }
    return row.identity_field;
  }

  try {
    // Introspect under the segment's OWN (workspace, game) ctx — per-game
    // cubes (event-level etl_*) exist only in that game's /meta, and their
    // join-probe identity only compiles under that game's token.
    const ctx = buildIntrospectionCtx(opts?.workspaceId ?? null, gameId ?? null);
    const suggestions = await suggestIdentities(ctx);
    const hit = suggestions.find(
      (s) =>
        s.cube === cube &&
        s.identity_field &&
        s.confidence >= AUTO_SUGGEST_MIN_CONFIDENCE,
    );
    return hit?.identity_field ?? null;
  } catch {
    return null;
  }
}
