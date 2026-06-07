/**
 * Idempotent boot-time rewrite of legacy `'dev'`-owned chat sessions to the
 * dev-admin owner (mirrors server/src/auth/dev-owner-backfill.ts).
 *
 * Gated by DEV_OWNER_BACKFILL_TO — set ONLY in local dev `.env` where the
 * gateway synthesizes the bootstrap-admin identity. Real-auth stacks key
 * owners on Keycloak subs; rewrite those with scripts/reassign-session-owner.ts
 * and the real sub instead. Runs AFTER snapshot hydration so freshly-seeded
 * 'dev' rows are caught in the same boot.
 */

import type Database from 'better-sqlite3';

const LEGACY_OWNER = 'dev';

/** @returns sessions rewritten; 0 when the env gate is off or nothing matched. */
export function backfillLegacyDevOwner(db: Database.Database): number {
  const to = (process.env['DEV_OWNER_BACKFILL_TO'] ?? '').trim();
  if (!to || to === LEGACY_OWNER) return 0;
  const res = db
    .prepare('UPDATE chat_sessions SET owner_id = ? WHERE owner_id = ?')
    .run(to, LEGACY_OWNER);
  return res.changes;
}
