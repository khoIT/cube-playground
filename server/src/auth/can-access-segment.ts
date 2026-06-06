/**
 * Segment access predicates — the single decision point for who may read or
 * mutate a segment, applied identically on the LIST query, every by-id route,
 * and the glossary reverse-index dereference.
 *
 * Visibility ladder (unified vocabulary, see trust-mapping.ts):
 *   personal (NULL → personal) — owner or admin only;
 *   shared / org               — any member of the active workspace.
 *
 * The owner key is the Keycloak `sub` (principal.sub), NEVER email — using email
 * here would re-introduce the "owner-scope never matched in dev" duality bug.
 * Workspace scoping is enforced separately by the route (cross-workspace = 404);
 * these predicates decide access WITHIN the active workspace.
 */

import { SEGMENT_DEFAULT_VISIBILITY } from '../services/trust-mapping.js';
import type { Principal } from './principal.js';

export interface SegmentAccessRow {
  owner: string;
  /** NULL is treated as 'personal' (honors migration 028 — no backfill). */
  visibility: string | null;
}

/** NULL → 'personal'. Mirrors the SQL `COALESCE(visibility,'personal')`. */
function effectiveVisibility(row: SegmentAccessRow): string {
  return row.visibility ?? SEGMENT_DEFAULT_VISIBILITY;
}

/** True if the principal may READ this segment within the active workspace. */
export function canAccessSegment(principal: Principal, row: SegmentAccessRow): boolean {
  if (principal.role === 'admin') return true;
  if (row.owner === principal.sub) return true;
  const vis = effectiveVisibility(row);
  return vis === 'shared' || vis === 'org';
}

/**
 * True if the principal may MUTATE this segment. Personal segments are
 * owner/admin only; shared/org remain collaboratively editable by workspace
 * members (preserves the prior workspace-shared write contract for those).
 */
export function canMutateSegment(principal: Principal, row: SegmentAccessRow): boolean {
  return canAccessSegment(principal, row);
}

/**
 * True if the principal may ADMINISTER this segment — the owner/admin-only
 * destructive set: delete, visibility changes (incl. share/unshare), cohort
 * redefinition (predicate_tree / uid_list rewrite, append), and activation
 * removal. Collaborative writes (rename, cadence, tags, analyses, refresh)
 * stay on canMutateSegment so shared/org segments remain workspace-editable.
 */
export function canAdministerSegment(principal: Principal, row: SegmentAccessRow): boolean {
  return row.owner === principal.sub || principal.role === 'admin';
}
