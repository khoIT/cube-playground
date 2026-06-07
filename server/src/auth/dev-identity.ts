/**
 * Local-dev (AUTH_DISABLED) identity — the synthesized admin every request
 * runs as when Keycloak is off.
 *
 * The app has no `'dev'` placeholder identity anymore: the local stack runs
 * as the FIRST bootstrap admin so grants, audit rows, owned artifacts and the
 * admin UI all resolve to the same real person in dev and prod. In dev mode
 * the owner sub IS the email string (legible, stable); real Keycloak UUIDs
 * only exist on real-auth stacks.
 */

import { parseBootstrapAdmins } from './bootstrap-admins.js';

/** Org-default first admin when AUTH_BOOTSTRAP_ADMINS is unset locally. */
export const DEFAULT_DEV_ADMIN_EMAIL = 'khoitn@vng.com.vn';

/** Email identity of the synthesized dev admin (grant/audit/display key). */
export function devAdminEmail(): string {
  return parseBootstrapAdmins(process.env.AUTH_BOOTSTRAP_ADMINS)[0] ?? DEFAULT_DEV_ADMIN_EMAIL;
}

/** Owner-column key the dev admin writes/reads artifacts under. */
export function devOwnerSub(): string {
  return devAdminEmail();
}

/** Short display handle, e.g. 'khoitn' from 'khoitn@vng.com.vn'. */
export function devUsername(): string {
  return devAdminEmail().split('@')[0] ?? devAdminEmail();
}
