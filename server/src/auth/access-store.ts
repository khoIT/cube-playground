/**
 * DB-authoritative access store — the single source of truth for authorization.
 *
 * `getAccess(email)` resolves a user's role, status, and workspace/game/feature
 * grants in one call, behind a short TTL cache. Mutators live in
 * `access-store-mutators.ts`; they call `invalidate()` here on every write so a
 * change takes effect on the user's next request without a restart.
 *
 * Email is the grant key — always normalized (lowercase + trim) on read AND
 * write so `Alice@Corp.com` and `alice@corp.com` can't hold divergent grants.
 */

import { getDb } from '../db/sqlite.js';
import {
  FEATURE_KEYS,
  featureDefaultEnabled,
  type FeatureKey,
} from './feature-keys.js';

export type AppRole = 'viewer' | 'editor' | 'admin';
export type AccessStatus = 'pending' | 'active' | 'disabled';

export interface AccessRecord {
  email: string;
  role: AppRole;
  status: AccessStatus;
  kcSub: string | null;
  workspaces: string[];
  /** Game grants scoped per workspace id. Absent/empty key = no games granted
   *  in that workspace (fail-closed in the authorization layer). */
  gamesByWorkspace: Record<string, string[]>;
  features: Record<FeatureKey, boolean>;
}

interface UserAccessRow {
  email: string;
  role: AppRole;
  status: AccessStatus;
  kc_sub: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---- TTL cache -------------------------------------------------------------

interface CacheEntry {
  value: AccessRecord | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheTtlMs(): number {
  const raw = Number(process.env.ACCESS_CACHE_TTL_MS ?? 30_000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

/** Drop one email (or the whole cache) — called by every mutator. */
export function invalidate(email?: string): void {
  if (email) cache.delete(normalizeEmail(email));
  else cache.clear();
}

// ---- Feature resolution ----------------------------------------------------

interface FeatureFlagRow {
  scope: 'user' | 'role';
  subject: string;
  feature_key: string;
  enabled: number;
}

/**
 * Resolve the full feature map: start from per-key defaults, layer role-scoped
 * flags, then user-scoped flags (user overrides role overrides default).
 */
function resolveFeatures(email: string, role: AppRole): Record<FeatureKey, boolean> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT scope, subject, feature_key, enabled FROM feature_flags
        WHERE (scope = 'role' AND subject = ?) OR (scope = 'user' AND subject = ?)`,
    )
    .all(role, email) as FeatureFlagRow[];

  const map = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) map[key] = featureDefaultEnabled(key);
  // The admin surface is default-off for everyone EXCEPT admin-role users, so a
  // freshly-seeded/bootstrap admin can reach the access page without an extra
  // explicit flag. Explicit user/role flags below still override this.
  map.admin = role === 'admin';

  // Apply role-scope first so user-scope wins on conflict.
  for (const scope of ['role', 'user'] as const) {
    for (const r of rows) {
      if (r.scope !== scope) continue;
      if (!(r.feature_key in map)) continue;
      map[r.feature_key as FeatureKey] = r.enabled === 1;
    }
  }
  return map;
}

// ---- Read path -------------------------------------------------------------

function readAccess(email: string): AccessRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT email, role, status, kc_sub, created_at, updated_at
         FROM user_access WHERE email = ?`,
    )
    .get(email) as UserAccessRow | undefined;
  if (!row) return null;

  const workspaces = (
    db.prepare('SELECT workspace_id FROM user_workspace_access WHERE email = ?').all(email) as Array<{
      workspace_id: string;
    }>
  ).map((w) => w.workspace_id);

  const gameRows = db
    .prepare('SELECT workspace_id, game_id FROM user_game_access WHERE email = ?')
    .all(email) as Array<{ workspace_id: string; game_id: string }>;
  const gamesByWorkspace: Record<string, string[]> = {};
  for (const { workspace_id, game_id } of gameRows) {
    (gamesByWorkspace[workspace_id] ??= []).push(game_id);
  }

  return {
    email: row.email,
    role: row.role,
    status: row.status,
    kcSub: row.kc_sub,
    workspaces,
    gamesByWorkspace,
    features: resolveFeatures(email, row.role),
  };
}

/** Resolve all grants for an email (cached). Returns null if no row exists. */
export function getAccess(emailRaw: string): AccessRecord | null {
  const email = normalizeEmail(emailRaw);
  const now = Date.now();
  const hit = cache.get(email);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = readAccess(email);
  cache.set(email, { value, expiresAt: now + cacheTtlMs() });
  return value;
}

// ---- Listing (admin API) ---------------------------------------------------

export interface AccessListItem extends AccessRecord {
  lastLogin: string | null;
}

/** All users with their resolved grants + last-login (joined from audit table). */
export function listUsers(): AccessListItem[] {
  const db = getDb();
  const emails = (
    db.prepare('SELECT email FROM user_access ORDER BY email').all() as Array<{ email: string }>
  ).map((r) => r.email);

  return emails.map((email) => {
    const rec = readAccess(email)!;
    // One email can map to >1 users row (the `users` PK is the owner-sub, which
    // is the KC UUID in real-auth but the email in dev) — pick the most recent
    // login so a fresh dev row wins over a stale real-auth leftover.
    const audit = db
      .prepare('SELECT last_login FROM users WHERE LOWER(email) = ? ORDER BY last_login DESC LIMIT 1')
      .get(email) as { last_login: string } | undefined;
    return { ...rec, lastLogin: audit?.last_login ?? null };
  });
}

/** Test-only: clear the in-process cache. */
export function __resetAccessCache(): void {
  cache.clear();
}
