/**
 * Resolve the identity (uid) dimension for a cube. Manual mapping in
 * `cube_identity_map` wins; otherwise fall back to the high-confidence
 * auto-suggester so a "revert to auto" toggle in Settings doesn't strand
 * downstream consumers. Used by both the refresh job and the live preview
 * so their count methodologies stay in lock-step.
 */

import { getDb } from '../db/sqlite.js';
import { suggestIdentities } from './identity-suggester.js';
import { resolveGamePrefix } from './resolve-game-prefix.js';
import { logicalCubeAcross } from './cube-member-resolver.js';

const AUTO_SUGGEST_MIN_CONFIDENCE = 0.9;

/**
 * Resolve the identity (uid) dimension for a cube. Accepts an optional gameId
 * so background jobs (refresh-segment) can pass the segment's game context.
 *
 * Persisted overrides are stored in LOGICAL (prefix-stripped) space by the PUT
 * handler. When a physical cube name is passed (`ballistar_mf_users`) on a
 * prefix workspace, we derive the prefix via resolveGamePrefix and strip it
 * before looking up the DB, then physicalize the stored field back before
 * returning. On game_id workspaces (prefix null) the helpers are all no-ops and
 * behavior is byte-for-byte unchanged.
 */
export async function resolveIdentityField(
  cube: string,
  gameId?: string | null,
): Promise<string | null> {
  const prefix = resolveGamePrefix(gameId ?? null);
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
