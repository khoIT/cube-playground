/**
 * Authorization boundary for the public export surface: does an API key's scope
 * permit reading a given segment row? Fail-closed — workspace must match, and
 * any non-null allowlist must contain the segment / game. A null allowlist means
 * "all within the workspace" (the workspace match still applies).
 *
 * Kept tiny and pure so it's trivially unit-testable and shared by both the
 * members export (Phase 03) and the metadata endpoints (Phase 04).
 */

import type { ApiKeyScope } from './api-key-store.js';

/** Minimal shape of a segment row the scope check needs. */
export interface SegmentScopeFields {
  id?: unknown;
  workspace?: unknown;
  game_id?: unknown;
}

export function canKeyAccessSegment(scope: ApiKeyScope, row: SegmentScopeFields): boolean {
  if (typeof row.workspace !== 'string' || row.workspace !== scope.workspace) return false;
  if (scope.segmentIds !== null) {
    if (typeof row.id !== 'string' || !scope.segmentIds.includes(row.id)) return false;
  }
  if (scope.gameIds !== null) {
    if (typeof row.game_id !== 'string' || !scope.gameIds.includes(row.game_id)) return false;
  }
  return true;
}
