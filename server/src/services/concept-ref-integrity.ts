/**
 * Cross-artifact referential integrity guard.
 *
 * Before deleting a metric or segment, callers check whether any glossary term
 * points at that artifact via its secondary_catalog_ids. If a reference exists
 * the delete should be rejected (409) to prevent dangling refs in the concept
 * graph.
 *
 * Kept minimal — single query, no caching. Called at delete time only.
 */

import { getDb } from '../db/sqlite.js';

/**
 * Returns the ids of glossary terms that contain `ref` in their
 * secondary_catalog_ids JSON array (e.g. "business_metrics/dau").
 *
 * An empty array means no constraint violation; non-empty means the delete
 * must be blocked.
 */
export function glossaryTermsReferencingArtifact(ref: string): string[] {
  const db = getDb();
  // JSON_EACH unpacks the array; the LIKE pre-filter keeps SQLite from
  // full-scanning the JSON for rows that cannot possibly match.
  const rows = db.prepare(`
    SELECT DISTINCT gt.id
    FROM glossary_terms gt, json_each(gt.secondary_catalog_ids) j
    WHERE gt.secondary_catalog_ids IS NOT NULL
      AND gt.secondary_catalog_ids LIKE ?
      AND j.value = ?
  `).all(`%${ref}%`, ref) as { id: string }[];
  return rows.map((r) => r.id);
}
