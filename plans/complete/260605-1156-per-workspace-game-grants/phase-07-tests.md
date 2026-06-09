# Phase 07 — Tests (Server + FE)

## Context Links
- Patterns to mirror: `server/test/rbac-enforcement.test.ts` (in-memory DB + migrations + JWT),
  `server/test/workspaces-grant-filter.test.ts` (stand-in auth middleware from headers),
  `server/test/admin-access-api.test.ts`, `server/test/access-store.test.ts`,
  `server/test/internal-access-route.test.ts`
- Migration apply pattern: `rbac-enforcement.test.ts:17-25` (`makeMemDb` reads all `.sql`, sorted)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** Cover the per-workspace + fail-closed behavior across all changed surfaces. No
  mocks for the DB path — use `:memory:` with real migrations (mirrors existing suites).

## Key Insights
- `makeMemDb` (`rbac-enforcement.test.ts:17-25`) auto-applies every `.sql` incl. the new `031-…` —
  the new schema is exercised for free once the file exists.
- Test NAMES must NOT reference phases/findings (repo rule). Describe scenarios:
  `setWorkspaceGames scopes delete to one workspace`, `userCanAccessGame denies game in ungranted workspace`.
- FE tests run under vitest + jsdom; mirror existing admin UI test
  (`src/pages/Admin/hub/__tests__/observability-tab.test.tsx`) and feature-access test patterns.

## Requirements — Server
1. **access-store** (`access-store.test.ts` extend / new file):
   - `readAccess` groups rows into `gamesByWorkspace`.
   - `setWorkspaceGames('u','ws-a',['g1'])` leaves `(u,'ws-b','g2')` intact (scoped delete).
   - `setWorkspaceGames` empty array clears only that workspace.
2. **authz-decisions** (new `authz-decisions-per-workspace.test.ts`):
   - grant in ws-a, request ws-a/g1 → allow; request ws-b/g1 → deny.
   - empty grant in active ws (but grants elsewhere) → deny (partial-grant fail-closed).
   - no grants anywhere + fallback ON → allow; fallback OFF → deny.
3. **workspace-header** enforcement (extend `rbac-enforcement.test.ts` or new): request with
   `x-cube-workspace: ws-b` + `x-cube-game: g1` for a user granted g1 only in ws-a → 403 GAME_FORBIDDEN.
4. **admin route** (`admin-access-api.test.ts` extend): `PUT …/workspaces/ws-a/games` persists ws-a
   only; unknown wsId → 400; audit row written with wsId.
5. **internal-access bridge** (`internal-access-route.test.ts` extend): non-admin with grants in
   ws-a + ws-b → `allowedGames` = canonical union; admin → `['*']`; AUTH_DISABLED → `['*']`.
6. **dev loop guard**: under `AUTH_DISABLED`, devUser can access any game in any workspace.

## Requirements — FE
7. **picker** (`use-game-context` test): real-auth user with `gamesByWorkspace={ws-a:[g1]}`, active
   ws-a → visibleGames=[g1]; active ws-b → []; AUTH_DISABLED → all games.
8. **admin UI** (`workspace-games-section` / access-editor test): selecting a workspace shows that
   ws's available games + current grant; save calls `putAdminUserWorkspaceGames(email, wsId, ids)`.

## Architecture
- Server: `:memory:` DB + real migrations + `signAppJwt` (real-auth path) OR header stand-in
  (workspaces-grant-filter style) where DB isn't needed.
- FE: render-hook / RTL with a stubbed `useAuth` state and stubbed fetch for `/api/workspaces` +
  `/games-readiness`.

## Related Code Files
- MODIFY/EXTEND: `server/test/access-store.test.ts`, `admin-access-api.test.ts`,
  `internal-access-route.test.ts`, `rbac-enforcement.test.ts`
- CREATE: `server/test/authz-decisions-per-workspace.test.ts`
- CREATE: FE `src/components/Header/use-game-context.per-workspace.test.tsx` (or extend existing)
- CREATE/EXTEND: `src/pages/Admin/access/__tests__/workspace-games-section.test.tsx`

## Implementation Steps
1. Server store + decision + route + bridge tests (items 1–6).
2. FE picker + admin UI tests (items 7–8).
3. Run `npm test` (server) and FE vitest; all green. Fix regressions in existing suites that
   assumed flat `games` (e.g. any fixture seeding `setGames` → `setWorkspaceGames`).
4. Grep existing tests for `setGames(` and flat `games:` fixtures; migrate them.

## Todo
- [ ] access-store grouping + scoped-delete tests
- [ ] authz-decisions per-workspace fail-closed tests
- [ ] workspace-header 403 cross-workspace test
- [ ] admin route per-ws persist + 400 + audit tests
- [ ] internal-access union/admin/auth-disabled tests
- [ ] dev-loop AUTH_DISABLED all-games test
- [ ] FE picker per-ws + fail-closed + dev test
- [ ] FE admin workspace-games-section test
- [ ] Migrate existing `setGames`/flat-`games` fixtures
- [ ] Full server + FE suites green

## Success Criteria
- All new tests pass; no existing suite regressed.
- Fail-closed and dev-loop both covered by explicit assertions.
- No test name references a phase/finding.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing fixtures use flat `setGames` → break | High | Med | Step 4 grep+migrate; expected churn |
| FE picker test flaky on async fetch | Med | Low | Stub fetch deterministically; await states |

## Security Considerations
- Tests are the regression guard for fail-closed — the core security property. Treat a missing
  deny-assertion as a blocker, not a nicety.

## Next Steps
- On green: hand to code-review, then ship. AUTHZ_GRANT_FALLBACK flip-off remains a later ops step.
