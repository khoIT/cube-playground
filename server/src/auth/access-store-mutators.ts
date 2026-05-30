/**
 * Write path for the access store. Every mutator normalizes the email and
 * calls `invalidate(email)` so the TTL cache can't serve a stale grant after a
 * change. Reads live in `access-store.ts`.
 *
 * Guard: `setRole`/`setStatus` refuse to demote or disable the LAST active
 * admin, so an admin can't lock the whole org out of the access page.
 */

import { getDb } from '../db/sqlite.js';
import { isFeatureKey, type FeatureKey } from './feature-keys.js';
import {
  getAccess,
  invalidate,
  normalizeEmail,
  type AccessStatus,
  type AppRole,
} from './access-store.js';

function nowIso(): string {
  return new Date().toISOString();
}

/** Count active admins — used to guard against self-lockout. */
function activeAdminCount(): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM user_access WHERE role = 'admin' AND status = 'active'`)
    .get() as { n: number };
  return row.n;
}

function isLastActiveAdmin(email: string): boolean {
  const current = getAccess(email);
  if (!current || current.role !== 'admin' || current.status !== 'active') return false;
  return activeAdminCount() <= 1;
}

export class LastAdminError extends Error {
  constructor() {
    super('Cannot remove the last active admin');
    this.name = 'LastAdminError';
  }
}

/**
 * Upsert a user row. Used for admin pre-provisioning (status defaults to
 * 'active') and login auto-create (caller passes status 'pending'). Existing
 * rows keep their status/role unless explicitly overridden.
 */
export function upsertUserAccess(args: {
  email: string;
  role?: AppRole;
  status?: AccessStatus;
  kcSub?: string | null;
}): void {
  const email = normalizeEmail(args.email);
  // Guard the upsert path too (not just setRole/setStatus): an admin must not be
  // able to demote/disable the last active admin via POST /api/admin/users.
  const demoting = args.role !== undefined && args.role !== 'admin';
  const disabling = args.status !== undefined && args.status !== 'active';
  if ((demoting || disabling) && isLastActiveAdmin(email)) throw new LastAdminError();
  const db = getDb();
  const now = nowIso();
  db.prepare(
    `INSERT INTO user_access (email, role, status, kc_sub, created_at, updated_at)
     VALUES (?, COALESCE(?, 'viewer'), COALESCE(?, 'pending'), ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       role       = COALESCE(excluded.role, user_access.role),
       status     = COALESCE(excluded.status, user_access.status),
       kc_sub     = COALESCE(excluded.kc_sub, user_access.kc_sub),
       updated_at = excluded.updated_at`,
  ).run(email, args.role ?? null, args.status ?? null, args.kcSub ?? null, now, now);
  invalidate(email);
}

/**
 * Login auto-create: insert a 'pending' row if the email is unknown so it
 * surfaces in the admin queue. No-op (besides sub reconcile) if a row exists.
 */
export function ensurePendingUser(emailRaw: string, kcSub: string): void {
  const email = normalizeEmail(emailRaw);
  const db = getDb();
  const existing = db.prepare('SELECT kc_sub FROM user_access WHERE email = ?').get(email) as
    | { kc_sub: string | null }
    | undefined;
  if (!existing) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO user_access (email, role, status, kc_sub, created_at, updated_at)
       VALUES (?, 'viewer', 'pending', ?, ?, ?)`,
    ).run(email, kcSub, now, now);
    invalidate(email);
    return;
  }
  if (!existing.kc_sub) reconcileSub(email, kcSub);
}

/** Capture the KC `sub` on first login (never overwrites an existing sub). */
export function reconcileSub(emailRaw: string, kcSub: string): void {
  const email = normalizeEmail(emailRaw);
  const db = getDb();
  db.prepare(
    `UPDATE user_access SET kc_sub = ?, updated_at = ? WHERE email = ? AND kc_sub IS NULL`,
  ).run(kcSub, nowIso(), email);
  invalidate(email);
}

export function setRole(emailRaw: string, role: AppRole): void {
  const email = normalizeEmail(emailRaw);
  if (role !== 'admin' && isLastActiveAdmin(email)) throw new LastAdminError();
  getDb().prepare('UPDATE user_access SET role = ?, updated_at = ? WHERE email = ?').run(
    role,
    nowIso(),
    email,
  );
  invalidate(email);
}

export function setStatus(emailRaw: string, status: AccessStatus): void {
  const email = normalizeEmail(emailRaw);
  if (status !== 'active' && isLastActiveAdmin(email)) throw new LastAdminError();
  getDb().prepare('UPDATE user_access SET status = ?, updated_at = ? WHERE email = ?').run(
    status,
    nowIso(),
    email,
  );
  invalidate(email);
}

/** Replace the user's workspace grants with exactly `workspaceIds`. */
export function setWorkspaces(emailRaw: string, workspaceIds: string[]): void {
  const email = normalizeEmail(emailRaw);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_workspace_access WHERE email = ?').run(email);
    const ins = db.prepare(
      'INSERT OR IGNORE INTO user_workspace_access (email, workspace_id) VALUES (?, ?)',
    );
    for (const id of new Set(workspaceIds)) ins.run(email, id);
  });
  tx();
  invalidate(email);
}

/** Replace the user's game grants with exactly `gameIds`. */
export function setGames(emailRaw: string, gameIds: string[]): void {
  const email = normalizeEmail(emailRaw);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_game_access WHERE email = ?').run(email);
    const ins = db.prepare('INSERT OR IGNORE INTO user_game_access (email, game_id) VALUES (?, ?)');
    for (const id of new Set(gameIds)) ins.run(email, id);
  });
  tx();
  invalidate(email);
}

/** Set per-user feature overrides. Each entry writes an explicit enabled flag. */
export function setFeatures(emailRaw: string, features: Record<string, boolean>): void {
  const email = normalizeEmail(emailRaw);
  const db = getDb();
  const up = db.prepare(
    `INSERT INTO feature_flags (scope, subject, feature_key, enabled)
     VALUES ('user', ?, ?, ?)
     ON CONFLICT(scope, subject, feature_key) DO UPDATE SET enabled = excluded.enabled`,
  );
  const tx = db.transaction(() => {
    for (const [key, enabled] of Object.entries(features)) {
      if (!isFeatureKey(key)) continue;
      up.run(email, key as FeatureKey, enabled ? 1 : 0);
    }
  });
  tx();
  invalidate(email);
}
