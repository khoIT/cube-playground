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

const AUTO_SUGGEST_MIN_CONFIDENCE = 0.9;

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
    const suggestions = await suggestIdentities();
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
