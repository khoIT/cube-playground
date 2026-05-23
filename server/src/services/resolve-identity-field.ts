/**
 * Resolve the identity (uid) dimension for a cube. Manual mapping in
 * `cube_identity_map` wins; otherwise fall back to the high-confidence
 * auto-suggester so a "revert to auto" toggle in Settings doesn't strand
 * downstream consumers. Used by both the refresh job and the live preview
 * so their count methodologies stay in lock-step.
 */

import { getDb } from '../db/sqlite.js';
import { suggestIdentities } from './identity-suggester.js';

const AUTO_SUGGEST_MIN_CONFIDENCE = 0.9;

export async function resolveIdentityField(cube: string): Promise<string | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT identity_field FROM cube_identity_map WHERE cube = ?')
    .get(cube) as { identity_field: string } | undefined;
  if (row?.identity_field) return row.identity_field;

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
