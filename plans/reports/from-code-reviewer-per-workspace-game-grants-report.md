# Review — Per-Workspace Game Grants (fail-closed RBAC)

Scope: working-tree change converting `user_game_access` GLOBAL→PER-WORKSPACE, fail-closed.
Note: branch `feat/per-workspace-game-grants` == `main` (604997a); the change lives UNCOMMITTED
in the working tree of worktree `feat/segment-kpi-compact-and-scope-fix`. Reviewed working-tree
state of the listed files. Ignored chat-service/* + Segments/* noise as instructed.

Verification done: read all core auth files; ran fresh `:memory:` migration (31 files, clean);
simulated backfill cross-join; ran 6 server suites (50 tests) + 3 FE suites (34 tests) — all green;
tsc clean (server + FE changed files).

## Overall verdict: SHIP

The security property holds end-to-end. Fail-closed is real per-workspace, no bypass found across
all three enforcement surfaces. Migration is safe + idempotent + access-preserving. No regression to
public contracts (old flat fields fully removed, no stale readers). Two non-blocking nits below.

---

## BLOCKERS: none

---

## AC verification (the WHY)

**AC1 — Fail-closed real, no bypass — PASS.**
`userCanAccessGame` (authz-decisions.ts:56-66): grant in target ws + game ∈ list ⇒ allow; target ws
empty/absent ⇒ deny UNLESS no-grants-in-ANY-workspace + fallback ⇒ allow. Cross-workspace leakage
blocked (grant in ws-A does NOT satisfy ws-B). All 3 server call sites pass the ACTIVE workspace id:
- workspace-header.ts:123 → `workspace.id` (resolved from `x-cube-workspace`, the active ws). ✓
- business-metrics-drift.ts:98 → `req.workspace.id`, all 5 route invocations (136/227/313/369/389). ✓
- onboarding.ts:58 → `req.workspace.id`, 11 invocations incl. dual-game cross-game-join (490+493). ✓
Grepped `userCanAccessGame` — no caller missed; no caller passes a stale/wrong ws.
Deny-assertions present in authz-decisions-per-workspace.test.ts (cross-ws, target-empty,
target-absent, fallback-off). Security scenarios are covered.

**AC2 — Three surfaces consistent, union can't over-grant — PASS.**
internal-access.ts `allowedGamesFor` emits workspace-AGNOSTIC UNION (admin/no-grants+fallback ⇒ `*`).
Cannot over-grant: the authoritative per-workspace gate (workspace-header) runs FIRST and 403s before
ANY cube token is minted, so cube-dev's checkAuth is only ever consulted for a game the gate already
allowed in the active ws. The broader union is reachable only post-gate ⇒ defense-in-depth, not a hole.
Union `*`/fallback behaviour matches the gate's fallback. GAME_ALIASES canonicalization correct.

**AC3 — Migration safety — PASS.**
031 recreates table with composite PK `(email, workspace_id, game_id)` + backfills via
`user_game_access JOIN user_workspace_access ON email`. Runner (sqlite.ts) is count-keyed
(`files.slice(currentVersion)`, `user_version = files.length`) — 031 appended at slot 31, numbering
contiguous, never renumbered. No FK INTO user_game_access exists (only 019 CREATE + 031) ⇒ DROP TABLE
safe under `foreign_keys=ON`. Verified fresh `:memory:` applies all 31 cleanly; final schema correct.
Backfill simulation: alice(2ws×2games)→4 rows preserved; bob(games,no-ws-grant)→0 rows; carol(ws,no
games)→0 rows. bob is NOT stranded — 0 grants anywhere ⇒ no-grants fallback allows (fallback ON). ✓
Behavioral edge (documented, correct-by-design): the instant bob gets ANY game grant seeded in ANY ws,
fallback stops firing and he is strictly fail-closed everywhere. Migration comment + plan call this out.

**AC4 — Dev loop intact — PASS.**
authenticate.ts `devUser` builds `gamesByWorkspace[w.id]=allGames` per registry ws ⇒ per-ws check
always allows; never strands. internal-access + auth.ts short-circuit on AUTH_DISABLED to all-games
admin. FE `narrowGamesByWorkspaceGrant` passes through when `!isRealAuth` or unresolved ws id.

**AC5 — No public-contract regression — PASS.**
`access.games`→`gamesByWorkspace` everywhere (AccessRecord, AuthzSubject, Principal, AuthenticatedUser,
AuthUser). `/me` returns `request.user` (carries gamesByWorkspace); login callback mirrors it (parity).
Admin: `/users/:email/games`→`/users/:email/workspaces/:wsId/games`; create-body `gameIds`→
`gamesByWorkspace`; `/registry` adds `gamesByWorkspace`. Greps clean: no remaining reader of old flat
`.games` grant (all hits are config/registry game-lists), no `allowedGames` user-field reader (only the
intended cube-dev wire contract), `setGames`/`gameIdsBody`/`putAdminUserGames` fully removed.
`setWorkspaceGames` DELETE is scoped `AND workspace_id = ?` ⇒ cannot wipe other workspaces' grants.

**AC6 — Admin UI — PASS.**
workspace-games-section.tsx: selector scoped to `user.workspaces` ∩ registry; options from
`registry.gamesByWorkspace[wsId]`; `key={wsId}` remount; hooks unconditional (no order violation).
Design tokens throughout (`--border-card`, `--bg-card`, `--radius-lg`, `--font-sans`, `--text-primary`,
`--text-muted`) — compliant with design-guidelines.md. Duplication concern: NONE — access-editor.tsx
AND hub/access-controls.tsx both import the SAME WorkspaceGamesSection, no logic copy.

---

## SHOULD-FIX

1. **Create-user path skips workspace-id validation that the dedicated PUT enforces.**
   admin-access.ts:99-104 — `POST /api/admin/users` loops `gamesByWorkspace` and calls
   `setWorkspaceGames(target, wsId, gameIds)` for every entry WITHOUT `resolveWorkspace(wsId)`, whereas
   `PUT /users/:email/workspaces/:wsId/games` (admin-access.ts:127-130) rejects unknown ws with 400.
   Impact: an admin can write junk grant rows for a non-registered workspace id. NOT a privilege
   escalation (junk ws never matches a resolved request ws ⇒ gate never reads it; admin-only surface),
   but it's an inconsistency and lets orphan rows accumulate. Fix: same `resolveWorkspace` guard in the
   create loop (skip/400 on unknown wsId).

## NIT

2. **Read-only onboarding draft routes ungated by game grant** — `GET /api/onboarding/drafts?game=`
   (onboarding.ts:411) and `GET /drafts/:id` (416) return draft contents/audit without a
   `userCanAccessGame` check, so an editor with game-A grants can READ game-B draft models. PRE-EXISTING
   (diff confirms onboarding.ts only added the `req.workspace.id` arg to existing calls — these reads
   were never gated). All MUTATIONS are gated. Out of scope for this change; flag for a follow-up read
   ACL if draft contents are considered sensitive.

---

## Positives
- Decision fn is pure + single-source; middleware just plumbs `req.user`. Highly testable.
- Surface-3 (cube bridge) rationale is explicit and correct — union as defense-in-depth, not the gate.
- Backfill access-preservation + no-strand fallback reasoning is documented in the SQL itself.
- FE narrowing exported + unit-tested against the REAL fn (not a copy) — 7 deny/allow cases.
- `setWorkspaceGames` scoped DELETE is the right primitive; create+PUT both route through it.

## Metrics
- Server typecheck: clean. FE typecheck (changed files): clean.
- Tests run here: 50 server (6 suites) + 34 FE (3 suites) = 84 pass. (Full suite per brief: 768/1727.)
- Security deny-assertions: present for every AC1 fail-closed branch.

## Unresolved questions
- SHOULD-FIX #1: apply the registry guard in the create loop now, or accept admin-only orphan-row risk?
- NIT #2: are onboarding draft model contents sensitive enough to warrant a read ACL? (separate change)
- Confirm intended workflow: change is uncommitted in a differently-named worktree, not on
  `feat/per-workspace-game-grants` (which == main). Commit target before ship?

**Status:** DONE_WITH_CONCERNS
