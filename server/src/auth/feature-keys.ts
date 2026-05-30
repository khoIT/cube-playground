/**
 * Canonical feature-key registry — the single vocabulary shared by the admin
 * UI, the server feature gate (`require-feature.ts`), and the access store.
 *
 * Keys mirror the FE nav sections (`use-visible-nav-items.ts` NavItemId) plus
 * `admin` for the access-management page. Keep this list in sync with the FE
 * nav: a feature key here is what an admin toggles per-user/per-role, and what
 * `requireFeature(key)` enforces server-side.
 *
 * Default-on policy: features NOT explicitly listed in `DEFAULT_OFF_FEATURES`
 * resolve to enabled for any active user unless a flag says otherwise. Only
 * `admin` is default-off (sensitive surface, must be explicitly granted).
 */

export const FEATURE_KEYS = [
  'chats',
  'playground',
  'data-model',
  'metrics-catalog',
  'liveops',
  'dashboards',
  'segments',
  'admin',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * Features that are denied unless explicitly granted (default-deny per key).
 * Everything else is allowed by default for active users — the gate only
 * needs to enumerate the sensitive surfaces.
 */
export const DEFAULT_OFF_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['admin']);

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/** Default enabled-state for a feature when no explicit flag exists. */
export function featureDefaultEnabled(key: FeatureKey): boolean {
  return !DEFAULT_OFF_FEATURES.has(key);
}
