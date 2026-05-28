---
title: "Cube Workspaces (local meta ↔ prod cube-dev)"
description: "Switch cube-playground between local dev meta and DA-controlled prod cube-dev as first-class workspaces; isolated artifacts, workspace-aware backend, readiness panel."
status: pending
priority: P2
branch: "main"
tags: [cube, workspace, data-source, meta]
blockedBy: []
blocks: []
related: [project:260527-1257-metric-cube-coverage-sync, project:260527-1306-glossary-resolver-consolidation]
created: "2026-05-27T08:58:24.940Z"
createdBy: "ck:plan"
source: skill
---

# Cube Workspaces (local meta ↔ prod cube-dev)

## Overview

Make cube-playground operate against two Cube sources as first-class **workspaces**:
`local` (`:4000`, minted HS256 JWT, `game_id`-scoped) and `prod` cube-dev
(`https://cube.gds.vng.vn/cubejs-api/v1`, open/no-token, flat prefix-namespaced). A
workspace = `{ id, label, cubeApiUrl, authMode, gameModel, gamePrefixMap }` held in a
**server-side registry**; frontend sends only a workspace **id** header (SSRF guard).
Switching re-points the whole app and swaps to isolated, meta-valid artifacts. Source of
truth: `plans/reports/brainstorm-260527-1539-cube-workspace-switching.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Backend workspace registry + per-request Cube ctx](./phase-01-backend-workspace-registry-per-request-cube-ctx.md) | ✅ Complete |
| 2 | [Frontend WorkspaceContext + switcher + consolidated meta client](./phase-02-frontend-workspacecontext-switcher-consolidated-meta-client.md) | 🟡 Partial — meta-client consolidation deferred |
| 3 | [Prefix-mapped game selector](./phase-03-prefix-mapped-game-selector.md) | 🟡 Partial — GamePicker disabled-state deferred |
| 4 | [Server-side per-workspace artifact storage](./phase-04-artifact-isolation-localstorage-segments.md) | 🟡 Partial — migration + segments stamp/filter only |
| 5 | [Workspace readiness panel](./phase-05-workspace-readiness-panel.md) | Pending |
| 6 | [Keycloak SSO + basic RBAC](./phase-06-keycloak-sso-and-basic-rbac.md) | Pending |
| 7 | [Chat-service workspace awareness](./phase-07-chat-service-workspace-awareness.md) | Pending |

> Status report: `plans/reports/cook-260528-1128-cube-workspace-switching-status.md`

## Key Decisions (brainstorm + follow-up Q&A)

- Server-side workspace registry; client sends **id only** (`x-cube-workspace` header). No raw URL from client.
- **Shared** business-metrics registry, reconciled against each workspace's meta.
- **No localStorage for data** (production multi-user): artifacts move **server-side, scoped
  `(owner, workspace)`**; only device-ephemeral view state stays client-side.
- Pluggable `authMode`: `none` (prod) | `minted` (local) | `env-token`.
- Game selector **prefix-maps** when `gameModel==='prefix'` (prod) else `game_id` path (local).
- **Sequencing: workspace first, RBAC follows** — Phases 1–5 run on the interim `X-Owner`
  seam; **Phase 6 adds Keycloak SSO + RBAC** (workspace access, artifact ownership, per-game).

## Verified live (prod cube-dev)

- `/meta` AND `/load` both **open** (HTTP 200, no token, CORS `*`, real data via `trino`).
- 79 entries; prefixes **cfm(41), cros(27), ballistar(11)**. Map: `cfm_vn→cfm`,
  `ballistar→ballistar`; `cros` has no configured game; `ptg/jus_vn/muaw/pubg` absent from prod.
- No data-model RBAC enforced by prod today (Cube Core supports `access_policy` v1.2.0+, but DA hasn't enabled it).

## Dependencies

- Phase 1 → 2 → 3 → 4. Phase 5 depends on 1–4. **Phase 6 depends on 1 + 4** (identity replaces
  owner seam, gates the registry + artifact routes). **Phase 7 depends on 1 + 4** (chat-service
  mirrors the workspace ctx + artifact-scoping patterns into the chat microservice).
- **Related plans:** `260527-1257-metric-cube-coverage-sync` (readiness reuses coverage resolver — Phase 5),
  `260527-1306-glossary-resolver-consolidation` (align Phase 2 meta-loader consolidation).
- **Reference:** Keycloak architecture from `/Users/lap16299/Documents/code/duongnt5` (Phase 6).

## Open questions

1. ~~`cros`~~ → **Resolved: add to `gds.config.json`**; display label (CrossFire PC?) TBD with DA.
2. ~~Dashboards persistence store~~ → **Resolved: server-side** (migration `010-dashboards.sql`); Phase 4 adds a workspace column.
3. VNG Keycloak realm name + client id + prod redirect URIs (Phase 6, infra input).
4. ~~Per-game access source of truth~~ → **Resolved: Keycloak** (roles + groups managed in
   devops-provided Keycloak UI; app is token-derived, no admin UI/`allowed_games` table). Only
   the KC group→game naming convention (e.g. `/games/<prefix>`) needs agreeing with devops.

## Validation Log

### Session 1 (2026-05-28)
**Verification pass (Full tier, 6 phases):** 18 file claims + 8 symbol claims checked.
- VERIFIED: 24 (all source files, key symbols, prod meta/load openness, prefix counts).
- FAILED: 2 — migration numbering (`005`/`006` already exist; renumbered to `017`/`018`);
  dashboards storage (claim "unknown" — actually server-side in `010-dashboards.sql`).
- Both auto-corrected in phase files (mechanical, no decision reversal).

**Interview decisions:**
| Question | Decision | Propagated to |
|---|---|---|
| Default workspace | **`prod`** (was `local`) | Phase 1 config, Phase 4 fallback |
| Interim prod gate (pre-RBAC) | **Allow prod immediately** on owner-header | Phase 4 risk note |
| Keycloak owner identity | **`preferred_username`** | Phase 6 owner-rekey |
| `cros` (27 prod cubes) | **Add to `gds.config.json`** (label TBD) | Phase 1 config, Phase 3 map |

**Recommendation:** Proceed to implementation. One soft input still pending (cros display label),
non-blocking — can be filled when Phase 3 lands.

### Session 2 follow-up (chat coverage)
Gap caught during scope confirmation: chat-service (port 3005) was outside Phases 1–6 and
would silently desync from the active workspace. **Resolved: added Phase 7** — chat-service
workspace awareness (per-request Cube ctx, meta-cache keyed by workspace, `chat_sessions`
gets `workspace_id`, frontend forwards `X-Cube-Workspace` on `/agent/turn`).
