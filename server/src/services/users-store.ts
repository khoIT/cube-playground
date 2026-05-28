/**
 * Thin users-table accessor — audit/cache only.
 *
 * `role` and per-game access are NEVER read from this table at request time;
 * they come from the live KC token (via the app JWT). The table just gives
 * us a stable FK for `segments.owner` etc. and a place to record first/last
 * login timestamps.
 */

import type { Database } from 'better-sqlite3';

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  role: 'viewer' | 'editor' | 'admin';
  first_login: string;
  last_login: string;
}

export interface UpsertArgs {
  id: string;
  username: string;
  email?: string;
  role: 'viewer' | 'editor' | 'admin';
}

/**
 * Insert-or-touch on KC login. Sets `first_login` once; `last_login` every
 * time. `role` is updated to mirror the latest KC snapshot — handy for
 * /api/auth/me to show the user their current role without an extra round
 * trip. Authorization decisions still come from the live token, not here.
 */
export function upsertUser(db: Database, args: UpsertArgs): UserRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, role, first_login, last_login)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username,
       email    = excluded.email,
       role     = excluded.role,
       last_login = excluded.last_login`,
  ).run(args.id, args.username, args.email ?? null, args.role, now, now);

  const row = db
    .prepare('SELECT id, username, email, role, first_login, last_login FROM users WHERE id = ?')
    .get(args.id) as UserRow;
  return row;
}

export function getUserById(db: Database, id: string): UserRow | null {
  const row = db
    .prepare('SELECT id, username, email, role, first_login, last_login FROM users WHERE id = ?')
    .get(id) as UserRow | undefined;
  return row ?? null;
}
