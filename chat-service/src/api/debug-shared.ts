/**
 * Shared owner-guard helpers used across debug API plugins.
 * Extracted so debug-annotations.ts and debug-search.ts can import without
 * circular dependencies on the main debug.ts plugin.
 */

import type Database from 'better-sqlite3';

/**
 * Synthetic sessions created by the pregenerate→verify workflow. They contain
 * no user data and the /dev/chat-audit/starters report links straight to them,
 * so any authenticated owner may read them (sessions, turns, raw SDK events)
 * and restore them if an old soft-delete left them pending purge.
 */
export const VERIFIER_OWNER_ID = 'starter-question-verifier';

/** True when the requester owns the resource, or it's a shared verifier session. */
export function canAccessOwnedResource(resourceOwnerId: string, requesterId: string): boolean {
  return resourceOwnerId === requesterId || resourceOwnerId === VERIFIER_OWNER_ID;
}

/**
 * True when the gateway marked this request as an admin audit read. The header
 * is set ONLY by the server proxy after verifying the caller's DB role —
 * chat-service is internal-only, so the trust boundary matches X-Owner-Id.
 * Grants cross-owner READ access on debug routes; mutations stay owner-scoped.
 */
export function isAdminAuditRequest(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  return headers['x-debug-admin'] === '1';
}

/** Extracts and validates X-Owner-Id header; returns null if missing/invalid. */
export function extractOwnerId(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const h = headers['x-owner-id'];
  return typeof h === 'string' && h.trim() ? h.trim() : null;
}

/**
 * Resolves the owner_id of a turn's owning session via a JOIN.
 * Returns null when the turn doesn't exist.
 */
export function getTurnOwnerId(db: Database.Database, turnId: string): string | null {
  const row = db
    .prepare(
      `SELECT cs.owner_id FROM chat_sessions cs
       JOIN chat_turns ct ON ct.session_id = cs.id
       WHERE ct.id = ?`,
    )
    .get(turnId) as { owner_id: string } | undefined;
  return row?.owner_id ?? null;
}
