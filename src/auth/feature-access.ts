/**
 * Frontend feature-access gate.
 *
 * Mirrors the server's `userHasFeature` decision (authz-decisions.ts) so the UI
 * shows exactly what the server would let through: a feature is enabled when the
 * user's resolved `features` map says so, else it defaults on — except the
 * sensitive `admin` surface, which is default-off. The server stays the
 * authority (every /api/admin/* call is gated); this layer just stops the UI
 * from offering surfaces the user can't use.
 */

import { useAuthUser, type AuthUser } from './auth-context';
import type { FeatureKey } from '../api/feature-open-beacon';

/** Default-off surfaces (must be explicitly granted). Mirrors the server. */
const DEFAULT_OFF_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['advisor', 'admin']);

export function featureEnabled(user: AuthUser | null, key: FeatureKey): boolean {
  // No resolved user (still bootstrapping) → don't hide. AuthGate blocks the
  // app tree until the user is resolved, so consumers inside it see a real user.
  if (!user) return true;
  const explicit = user.features?.[key];
  if (typeof explicit === 'boolean') return explicit;
  return !DEFAULT_OFF_FEATURES.has(key);
}

/** Hook form: returns a `(key) => boolean` bound to the current user. */
export function useHasFeature(): (key: FeatureKey) => boolean {
  const user = useAuthUser();
  return (key: FeatureKey) => featureEnabled(user, key);
}

/**
 * Map a router pathname to the FeatureKey that gates it, for URL-level blocking.
 *
 * Distinct from telemetry's `featureForPath`: that one is coarse (all `/catalog`
 * → metrics-catalog) which is fine for activity counting but WRONG for gating —
 * the data-model section lives at `/catalog/data-model` + `/catalog/concept`.
 * Returns null for routes that aren't feature-gated (settings, glossary,
 * drift-center, auth callbacks) so they stay reachable. `admin` is intentionally
 * omitted — its own role guard (AdminHubRoute) owns that redirect.
 */
export function featureForRoute(pathname: string): Exclude<FeatureKey, 'admin'> | null {
  const p = pathname.toLowerCase();
  const rules: Array<[string, Exclude<FeatureKey, 'admin'>]> = [
    ['/chat', 'chats'],
    ['/build', 'playground'],
    ['/catalog/data-model', 'data-model'],
    ['/catalog/concept', 'data-model'],
    ['/catalog/models', 'data-model'],
    ['/catalog/cubes', 'data-model'],
    ['/catalog/metrics', 'metrics-catalog'],
    ['/catalog/metric', 'metrics-catalog'],
    ['/schema', 'data-model'],
    ['/data-model', 'data-model'],
    ['/data', 'data-model'],
    // Legacy measure-detail redirect (/metric/:cube/:member) lands on a concept
    // page, which is a data-model surface — gate it to match the destination.
    // Listed after /catalog/metric* so the metrics-catalog routes win; the bare
    // /metric prefix can't swallow /metrics/* (needs exact /metric or /metric/).
    ['/metric', 'data-model'],
    ['/liveops', 'liveops'],
    ['/dashboards', 'dashboards'],
    ['/segments', 'segments'],
    ['/advisor', 'advisor'],
  ];
  for (const [prefix, key] of rules) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return key;
  }
  return null;
}
