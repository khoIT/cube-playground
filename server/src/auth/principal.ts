/**
 * The ONE place that maps a request to its identity keys.
 *
 * The app carries two identity keys that are NOT interchangeable:
 *   - owner column key  = Keycloak `sub`  (req.owner) — what artifacts
 *     (segments, dashboards, cube_aliases, user_prefs, chat owner_id) are
 *     written/scoped by. ALWAYS present.
 *   - grant / audit key = lowercased email — what `user_access`, `access_audit`
 *     and the admin UI key on. Nullable (only exists post-login) and is the
 *     display join, never the scoping key for owned artifacts.
 *
 * Telemetry keys on `sub` (always present); email is a display join.
 *
 * The canonical sub↔email map is `user_access.kc_sub` (reconciled on login,
 * indexed) — NOT `users.email`, which is nullable, unindexed, and absent for
 * a pre-provisioned-but-not-yet-logged-in user, which would re-introduce the
 * "owner-scope never matched in dev" bug.
 */

import type { FastifyRequest } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { normalizeEmail, type AppRole } from './access-store.js';
import type { AuthenticatedUser } from '../middleware/authenticate.js';

/**
 * Non-routable domain (RFC 6761 reserves `.invalid`) for synthesized dev
 * identities. Guarantees a synth email can never collide with a real grant or
 * telemetry row.
 */
export const DEV_EMAIL_DOMAIN = 'dev.invalid';

export interface Principal {
  /** Owner column key = Keycloak sub (req.owner). Always present. */
  sub: string;
  /** Grant/audit/display key (lowercased email). Null only when unresolvable. */
  email: string | null;
  role: AppRole;
  workspaces: string[];
  /** Game grants scoped per workspace id (mirrors AuthenticatedUser). */
  gamesByWorkspace: Record<string, string[]>;
  features: Record<string, boolean>;
}

/**
 * sub → email via the canonical `user_access.kc_sub` map. Null if unmapped.
 * Assumes sub-uniqueness (reconcileSub only writes a sub WHERE kc_sub IS NULL,
 * and a KC sub is 1:1 with an email at the IdP) — a future direct-kc_sub-write
 * path must preserve that invariant or this `.get()` returns an arbitrary row.
 */
export function emailForSub(sub: string): string | null {
  if (!sub) return null;
  const row = getDb()
    .prepare('SELECT email FROM user_access WHERE kc_sub = ?')
    .get(sub) as { email: string } | undefined;
  return row?.email ?? null;
}

/**
 * Every owner-sub a user's telemetry could be keyed under. Real-auth writes the
 * Keycloak UUID (`user_access.kc_sub`); dev mode writes the email itself
 * (`devOwnerSub()` === the bootstrap-admin email). A KC UUID never equals an
 * email, so unioning both keys is safe in prod (the email term simply matches
 * nothing) and recovers the dev-mode rows that a UUID-only read would miss.
 */
export function ownerSubsForEmail(emailRaw: string, kcSub: string | null): string[] {
  const email = normalizeEmail(emailRaw);
  return [...new Set([kcSub, email].filter((s): s is string => !!s))];
}

/**
 * email → sub via the canonical `user_access.kc_sub` map. Returns null when the
 * email is pre-provisioned but has not yet logged in (kc_sub IS NULL) — callers
 * then fall back to the email-keyed grant only.
 */
export function subForEmail(emailRaw: string): string | null {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const row = getDb()
    .prepare('SELECT kc_sub FROM user_access WHERE email = ?')
    .get(email) as { kc_sub: string | null } | undefined;
  return row?.kc_sub ?? null;
}

/**
 * Deterministic, non-routable synthetic email for a sub that has no real email
 * mapped. Used in dev (`AUTH_DISABLED`) so each distinct `X-Owner` resolves to a
 * distinct, non-colliding identity for multi-user simulation.
 */
function synthEmail(sub: string): string {
  const local = (sub || 'anonymous').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${local}@${DEV_EMAIL_DOMAIN}`;
}

/**
 * Resolve the request principal to BOTH identity keys plus its grants. This is
 * the single reader of `req.owner` / `req.user`; routes keep using `req.owner`
 * (sub) for owned-artifact scoping and `principal.email` for grant/audit/display.
 */
export function resolvePrincipal(req: FastifyRequest): Principal {
  const sub = req.owner;
  const u: AuthenticatedUser | undefined = req.user;

  if (u) {
    // Authenticated (real JWT or dev synth user). Prefer the token email; in dev
    // the synth user has none, so resolve via the canonical map (seeded grant)
    // and finally a deterministic non-routable synth address.
    const email = u.email ?? emailForSub(sub) ?? synthEmail(sub);
    return {
      sub,
      email,
      role: u.role,
      workspaces: u.workspaces,
      gamesByWorkspace: u.gamesByWorkspace,
      features: u.features,
    };
  }

  // Authenticated-but-unauthorized or anonymous: identity only, default-deny
  // grants. Email is a best-effort display join (null when unmapped).
  return {
    sub,
    email: emailForSub(sub),
    role: 'viewer',
    workspaces: [],
    gamesByWorkspace: {},
    features: {},
  };
}
