/**
 * Idempotent bootstrap-admin seed (cutover safety).
 *
 * Reads `AUTH_BOOTSTRAP_ADMINS` (comma-separated emails) and ensures each is an
 * `active` `admin` in `user_access`. Run once at server start so the very first
 * deploy of DB-authoritative authz never locks every operator out — without it,
 * a fresh `user_access` table has zero admins and nobody can reach the admin
 * page to grant access.
 *
 * Idempotent: upsert promotes existing rows to active-admin too, so re-running
 * (every boot) is safe and also "un-bricks" an accidentally-disabled seed admin.
 */

import { upsertUserAccess } from './access-store-mutators.js';

export function parseBootstrapAdmins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

export function seedBootstrapAdmins(): string[] {
  const emails = parseBootstrapAdmins(process.env.AUTH_BOOTSTRAP_ADMINS);
  for (const email of emails) {
    upsertUserAccess({ email, role: 'admin', status: 'active' });
  }
  return emails;
}
