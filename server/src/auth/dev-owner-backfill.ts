/**
 * Idempotent boot-time rewrite of legacy `'dev'`-owned rows to the current
 * dev-admin owner sub (see dev-identity.ts).
 *
 * Runs ONLY under AUTH_DISABLED: real-auth stacks key owners on Keycloak subs
 * and must never have their rows rewritten (any prod `'dev'` rows are
 * pre-cutover seed leftovers that are unreachable either way). Deliberately
 * NOT a SQL migration — migrations run everywhere; this is dev-stack-local
 * data repair tied to the synthesized identity.
 */

import { getDb } from '../db/sqlite.js';
import { devOwnerSub } from './dev-identity.js';

/**
 * Retired local-only owner aliases for the same person: 'dev' (the old
 * synthesized placeholder) and 'khoitn' (the username-form used by early seed
 * snapshots). Both unify onto the bootstrap-admin email sub.
 */
const LEGACY_OWNERS = ['dev', 'khoitn'] as const;

/**
 * Owner-bearing tables (column is `owner` in all). user_prefs and cube_aliases
 * carry owner-scoped uniqueness constraints, so the rewrite uses
 * UPDATE OR IGNORE + a sweep of unmovable leftovers — when both 'dev' and the
 * new owner already have a row for the same key, the new owner's row wins.
 */
const OWNED_TABLES = [
  'segments',
  'segment_analyses',
  'dashboards',
  'cube_aliases',
  'user_prefs',
] as const;

function authDisabled(): boolean {
  const raw = (process.env.AUTH_DISABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** @returns rows rewritten per table (for boot logging); empty when nothing to do. */
export function backfillLegacyDevOwner(): Record<string, number> {
  const to = devOwnerSub();
  if (!authDisabled() || (LEGACY_OWNERS as readonly string[]).includes(to)) return {};
  const db = getDb();
  const changed: Record<string, number> = {};

  db.transaction(() => {
    for (const table of OWNED_TABLES) {
      for (const legacy of LEGACY_OWNERS) {
        const res = db
          .prepare(`UPDATE OR IGNORE ${table} SET owner = ? WHERE owner = ?`)
          .run(to, legacy);
        // Leftovers = rows that collided with an existing new-owner row; the
        // existing row wins, the stale legacy duplicate is dropped.
        const swept = db.prepare(`DELETE FROM ${table} WHERE owner = ?`).run(legacy);
        const total = res.changes + swept.changes;
        if (total > 0) changed[table] = (changed[table] ?? 0) + total;
      }
    }
  })();

  return changed;
}
