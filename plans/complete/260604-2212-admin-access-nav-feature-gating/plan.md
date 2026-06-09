# Admin Access — Nav Cleanup + Workspace/Feature Grant Enforcement

## Problem
Four asks on the Admin "User & Access" governance surface:
1. Remove **API Settings** from the left nav.
2. **Data** (bottom nav) must be admin-gated, not always-on.
3. **Workspace grants** don't limit visible workspaces.
4. **Feature access** toggles do nothing (nav / settings / URL all ignore `user.features`).

## Root causes (verified)
- `bottom-row.tsx:39` hardcodes API Settings + `bottom-row.tsx:27` hardcodes Data — neither gated.
- `workspaces.ts:32` filters `/api/workspaces` by **role only**; never calls `userCanAccessWorkspace` (which exists, `authz-decisions.ts:33`).
- Sidebar/Settings/routes never read `user.features`. Only `/api/admin/*` is feature-gated. No FE route guard.
- Login callback (`auth.ts:114`) returns only `allowedGames` — FE lacks `features`/`workspaces` until a `/me` refresh.

## Locked decisions (user)
- API Settings → **move to a Settings tab** (keep the Cube-token modal reachable; just off the rail).
- Data → reuse the **`data-model`** feature key (no new key).
- Feature enforcement → **FE gate + route guard** (hide nav + settings tabs; redirect disabled URLs). Server admin gate stays; no new server API gates.
- Workspace grant semantics → mirror games: explicit grants restrict; empty falls back to role (existing `grantFallbackEnabled`).

## Changes
### Server
- `routes/workspaces.ts` — filter `/api/workspaces` via `userCanAccessWorkspace(user, w)`.
- `routes/auth.ts` — add `workspaces` + `features` to the login-callback user payload (parity with `/me`).

### Frontend
- NEW `src/auth/feature-access.ts` — `featureEnabled(user,key)`, `useHasFeature()`, `featureForRoute(pathname)` (route→feature map, distinct from coarse telemetry `featureForPath`).
- NEW `src/auth/feature-route-guard.tsx` — redirects disabled feature URLs to `/settings`.
- NEW `src/pages/Settings/api-settings-section.tsx` — relocated API credentials trigger.
- `src/auth/auth-context.tsx` — add `workspaces?: string[]` to `AuthUser`.
- `src/shell/sidebar/sidebar.tsx` — AND each section with `hasFeature(id)`.
- `src/shell/sidebar/bottom-row.tsx` — drop API Settings; gate Data with `hasFeature('data-model')`.
- `src/pages/Settings/settings-tabs.tsx` — add optional `feature?` to descriptor.
- `src/pages/Settings/settings-page.tsx` — feature-filter tabs (chat/liveops/dashboards); add `api` tab; guard direct-hash nav.
- `src/index.tsx` — mount `<FeatureRouteGuard />`.

### Tests
- `server/test/workspaces-grant-filter.test.ts` — explicit-grant restricts; empty→role fallback.
- `src/auth/feature-access.test.ts` — `featureEnabled` default-on/off + explicit; `featureForRoute` mapping.

## Status
| Step | State |
|------|-------|
| Server: workspace filter + callback payload | ✅ done |
| FE: feature-access core + guard | ✅ done |
| FE: sidebar + bottom-row gating | ✅ done |
| FE: settings tabs + API relocation | ✅ done |
| Tests + review | ✅ done |

## Verification (260604)
- New: server `workspaces-grant-filter` (3) + FE `feature-access` (10) pass.
- Regression: server auth/workspace/admin (36) + FE Settings/shell/auth (73) pass.
- Typecheck: server 0 errors; FE 72 = pre-existing baseline, 0 new.
- Code review: SHIP — no leaks, no redirect loop (blocked → `/settings`, which is ungated). Tightened MINOR (redirect-only catalog paths now gated on first tick).

## Notes / follow-ups
- Workspace grants override role visibility (explicit grant ⇒ only those), matching the game-grant reference. Confirmed intended.
- `FeatureKey` is defined in 3 places (server `feature-keys.ts`, FE `feature-open-beacon.ts`, `NavItemId`) — kept in sync manually; consolidation is a future nicety.
- Feature enforcement is FE gate + route guard (per decision); server only 403s `/api/admin/*`. Deeper per-feature server API gates remain a future option.
</content>
</invoke>
