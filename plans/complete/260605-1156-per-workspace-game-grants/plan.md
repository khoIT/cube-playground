---
title: "Per-workspace game grants"
description: "Convert global user_game_access into per-workspace game grants, fail-closed on empty grant."
status: pending
priority: P2
effort: ~10h
branch: main
tags: [auth, rbac, workspaces, migration]
created: 2026-06-05
---

# Per-Workspace Game Grants

Convert game grants from GLOBAL (`user_game_access(email, game_id)`) to PER-WORKSPACE
(`user_game_access(email, workspace_id, game_id)`). Admin grants games scoped to a workspace;
the game picker + server enforcement use the ACTIVE workspace's grants only.

## Locked Decisions (do not re-litigate)
1. **Model = per-workspace game grants.** Grant carries a workspace id.
2. **Empty-grant default = FAIL-CLOSED.** A user granted a workspace but with NO per-workspace
   game grants there sees NO games (picker empty, server denies). Per-game grant REQUIRED.

## Phase Table

| # | Phase | File | Status | Owner | Blocks |
|---|-------|------|--------|-------|--------|
| 1 | Schema migration + backfill | phase-01-schema-migration-backfill.md | pending | server | 2 |
| 2 | Access store + AuthzSubject shape | phase-02-access-store-authz-subject.md | pending | server | 3,4 |
| 3 | Enforcement (decision fns + middleware + cube bridge) | phase-03-enforcement-fail-closed.md | pending | server | 7 |
| 4 | Admin API (per-workspace set-games) | phase-04-admin-api-per-workspace.md | pending | server | 5,7 |
| 5 | Admin UI (workspace→games matrix) | phase-05-admin-ui-matrix.md | pending | frontend | 7 |
| 6 | FE picker (active-workspace grants) | phase-06-fe-picker-active-workspace.md | pending | frontend | 7 |
| 7 | Tests (server + FE) | phase-07-tests.md | pending | both | — |

## Dependency Graph
```
P1 ─▶ P2 ─▶ P3 ─┐
          └▶ P4 ─▶ P5
P2 ─────────────▶ P6
P3,P4,P5,P6 ────▶ P7
```
P5 and P6 (frontend) can run in parallel once P4's API contract is frozen. P3 and P4 (server)
can run in parallel once P2 lands (different files).

## Cross-Cutting Constraints
- **No plan/phase/finding refs** in migration filenames, code comments, or test names (repo rule).
  Migration filename = domain slug only: `031-per-workspace-game-grants.sql`.
- **Config parity:** any workspace-registry change lands in BOTH `workspaces.config.json` AND
  `workspaces.prod.config.json`. (No registry change expected this plan — flag if one appears.)
- **Do NOT break AUTH_DISABLED dev loop** (`devUser()` synthesizes admin/all-games).
- **Real-auth-only behavior** — not observable under AUTH_DISABLED (dev↔prod invisibility trap).
- Keep files <200 LOC; follow existing module boundaries.

## Key Architectural Risk (read first)
There are THREE game-enforcement surfaces, not one:
1. `workspace-header.ts` — server request gate (workspace IS known here).
2. `use-game-context.ts` — FE picker (active workspace tracked).
3. **`internal-access.ts` — cube-dev `checkAuth` bridge, keyed by EMAIL ONLY, NO workspace context.**

Surface 3 cannot see the active workspace (it answers cube-dev's per-email lookup). Decision in
P3: the bridge emits the UNION of the user's per-workspace game grants (defense-in-depth, not the
primary gate). Surface 1 is the authoritative per-workspace gate. See phase-03 for rationale.

## Open Questions (need user decision — see phase-01 + phase-03)
- **Backfill:** replicate each existing global game grant across every workspace the user currently
  has in `user_workspace_access`? (Proposed default — preserves current access.)
- **AUTHZ_GRANT_FALLBACK interaction:** keep per-workspace fail-closed always (recommended), or let
  fallback ease the no-grants-anywhere case? See phase-03 Decision section.
