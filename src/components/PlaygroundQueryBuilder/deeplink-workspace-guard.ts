/**
 * Tracks which workspace a playground URL deeplink (`?query=`, chat/segment
 * payloads) was opened under, so a workspace switch can DROP the now-foreign
 * query before it seeds the new workspace's tabs.
 *
 * Why this is module-level state, not a React ref/state:
 *   A workspace switch re-mints the Cube token → cubejsApi briefly nulls →
 *   QueryBuilderContainer renders <CubeLoader/> → QueryTabsRenderer unmounts and
 *   remounts. Anything initialized at mount resets to the NEW workspace and so
 *   never observes the switch. A module variable survives the remount.
 *
 * Why not validate the query's cubes against /meta instead:
 *   meta isn't reliably attached to the cube client at this layer, so a
 *   cube-name lookup yields false negatives. The origin-workspace stamp is
 *   deterministic and meta-independent.
 *
 * Why dropping (not URL-stripping) is the authoritative fix:
 *   ExplorePage re-pushes `?query=<active tab>` on every query/tab change, and
 *   QueryTabs re-seeds its tab from the URL param on remount. Stripping the URL
 *   loses the race against both. Forcing the foreign query to null lets
 *   QueryTabs fall back to the new workspace's OWN saved tabs, and the native
 *   query is what then gets pushed back to the URL.
 *
 * Read vs commit are split so the render-time check stays PURE: the verdict
 * (isDeeplinkForeign) only reads module state, and the stamp is written from an
 * effect (commitDeeplinkWorkspace). A render-time mutation would flip the
 * verdict under React StrictMode's double-invoke (the second invoke would see
 * the just-adopted workspace and read non-foreign).
 */

let deeplinkOriginWorkspace: string | null = null;

/**
 * Pure render-time check: is the URL's current deeplink foreign to the active
 * workspace (opened under a different one, i.e. carried across a switch)?
 * No side effects — safe to call during render and under StrictMode.
 */
export function isDeeplinkForeign(workspaceId: string, hasDeeplink: boolean): boolean {
  if (!hasDeeplink || !workspaceId) return false;
  return deeplinkOriginWorkspace !== null && deeplinkOriginWorkspace !== workspaceId;
}

/**
 * Commit the deeplink's origin workspace. Call from an effect (commit phase),
 * never during render. Maintains the stamp:
 *   - no deeplink present    → clear it (the next deeplink re-stamps)
 *   - workspace unresolved   → leave it (boot: empty-id → real-id isn't a switch)
 *   - deeplink + resolved ws → adopt the active workspace as native
 */
export function commitDeeplinkWorkspace(workspaceId: string, hasDeeplink: boolean): void {
  if (!hasDeeplink) {
    deeplinkOriginWorkspace = null;
    return;
  }
  if (!workspaceId) return;
  deeplinkOriginWorkspace = workspaceId;
}

/** Test-only: reset module state between cases. */
export function __resetDeeplinkWorkspaceGuard(): void {
  deeplinkOriginWorkspace = null;
}
