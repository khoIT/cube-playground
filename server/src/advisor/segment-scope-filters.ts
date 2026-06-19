/**
 * Compile a segment's stored predicate into Cube query filters so the diagnosis
 * lenses can scope their reads to the cohort (not the whole game).
 *
 * The diagnosis spine (lens-04 decomposition) measures the segment with these
 * filters and the population with none; the gap between the two is what marks a
 * factor "weak" → emits an opportunity → ranks a lever. Without real filters the
 * segment reads identically to the game (segValue == popValue), so nothing is
 * ever weak and the advise door can never recommend.
 *
 * Mirrors the segment-refresh path (jobs/refresh-segment.ts): resolve percentile
 * cutoffs first when the tree has any (Cube REST can't subquery), otherwise pass
 * the anchor date for relative-date leaves.
 *
 * Fails soft: a manual segment (no predicate), a missing row, or a malformed
 * tree returns [] — the lens then reads the full population, which the caller
 * surfaces honestly rather than fabricating a cohort.
 */

import type { PredicateNode } from '../types/predicate-tree.js';
import { getDb } from '../db/sqlite.js';
import { treeToCubeFilters } from '../services/translator.js';
import {
  collectPercentileLeaves,
  resolveSegmentCutoffs,
} from '../services/segment-cutoff-resolver.js';

/**
 * Load segment `segmentId`'s predicate tree and translate it to Cube filters.
 * Returns [] when the segment has no predicate (manual/uid-list segment), is
 * unknown, or its predicate can't be parsed.
 *
 * @param anchorDate "as of" date for relative-date leaves (e.g. days_since_*).
 */
export async function compileSegmentScopeFilters(
  segmentId: string,
  anchorDate: Date,
): Promise<unknown[]> {
  const row = getDb()
    .prepare('SELECT predicate_tree_json FROM segments WHERE id = ?')
    .get(segmentId) as { predicate_tree_json: string | null } | undefined;

  // Manual (uid-list) segments and unknown ids have no predicate to compile.
  if (!row?.predicate_tree_json) return [];

  let tree: PredicateNode;
  try {
    tree = JSON.parse(row.predicate_tree_json) as PredicateNode;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`[segment-scope] segment ${segmentId} has malformed predicate_tree_json`);
    return [];
  }

  // Percentile leaves (e.g. "top 25% by LTV") need a scalar cutoff resolved
  // against the live distribution before Cube translation; the common
  // threshold/equals segment skips the Trino round-trip entirely.
  if (collectPercentileLeaves(tree).length > 0) {
    const resolvedPercentiles = await resolveSegmentCutoffs(tree);
    return treeToCubeFilters(tree, { resolvedPercentiles, anchorDate });
  }

  return treeToCubeFilters(tree, { anchorDate });
}
