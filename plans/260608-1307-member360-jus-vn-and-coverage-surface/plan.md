# Member 360 — enable jus_vn + per-game coverage surface

## Goal
Enable Member 360 for **jus_vn** (local + prod), then build a **per-game coverage surface** that
shows, across the Trino → Cube YAML → product chain: which 360 panels/charts compute today vs
which are blocked pending more data/modeling. Surface in **two places**: the Settings coverage
admin page and a contextual tab/banner on the Member 360 page.

## The three gated layers (verified)
| Logical view (product) | Base cube | Trino table |
|---|---|---|
| `user_profile` | `mf_users` | `mf_users` |
| `user_activity_timeline` | `active_daily` | `std_ingame_user_active_daily` |
| `user_recharge_timeline` | `user_recharge_daily` | `std_ingame_user_recharge_daily` |
| `user_transactions` | `recharge` | `etl_ingame_recharge` |

Enabling a game needs: (1) Trino tables/cols → (2) base cubes + `views/<game>/user_360.yml` →
(3) product config (`PANELS_BY_GAME` + `SECTIONS_BY_GAME` FE, mirrored server `CORE_PANELS_BY_GAME`).

## Why jus_vn is ready
`cube-dev-old/cube/model/cubes/jus/` has all 4 base cubes; `jus/mf_users.yml` ≈ ballistar's
(72 vs 75 dims) — full `user_profile` coverage. Lacks `etl_*` event tables → no CFM-style event
panels, only the **core 360** (ballistar shape). Missing: `views/jus/user_360.yml` + product config.

## Decisions (locked)
- Coverage signal: **hybrid** — `/meta` diff (modeled?) + 1-row data probe (has rows?).
- Target games: **ballistar + cfm_vn + jus_vn**. ballistar & cfm_vn already enabled (reference /
  verify-only); **jus_vn is the new enablement**. Matrix still lists all games (others = blocked/na).
- Output: **phased plan first**, then implement.
- Admin surface: **Data coverage lives inside the Sys-admin hub → "Dev" tab at `/admin/dev`**
  (NOT a Drift Center rename — Health Center idea dropped). Add a sub-tab there:
  "Chat-Audit" (existing `CrossUserAuditPanel`, default) + **"Data coverage"** (new). Inherits the
  existing admin role-guard. Data coverage = **all-games matrix** + layer-aware resolve pane
  (scaffold-draft action). Drift Center stays as-is (metric drift, unchanged).
- End-user surface: fully-blocked → **disabled chip + tooltip** on Members tab;
  partial → **render computable panels + per-panel placeholders** on the 360 page.
- UI style (locked via huashu draft `design/member360-coverage-uis.html`): chain = **dot stepper**,
  status = **dot + label** pills.
- Scope: **local cube workspace first**; prod (prefixed/upstream) parity = tracked follow-up.

## Phases
- [ ] **phase-00-discovery** — confirm jus dim diff, read Settings coverage + workspace-readiness pattern, server member360 registry/precompute, FE sections config, jus_vn workspace config (local+prod).
- [x] **phase-01-cube-view-jus** — authored `cube-dev/cube/model/views/jus/user_360.yml` (VENDORED model dir the local stack mounts, not cube-dev-old). 4 core + 3 audience views, jus-field-accurate. VERIFIED: restarted `cube-playground-cube-api-dev` (hot-reload doesn't fire on `:ro` mount); clean compile; all 7 views present in `/meta` for game=jus. Member 360 page loads. (Reload gotcha → lessons-learned in phase-05.)
- [x] **phase-02-product-enable-jus** — `jus`/`jus_vn` → `BALLISTAR_PANELS` in `member360-panels.ts`; → `BALLISTAR_SECTIONS` in `member360-sections.ts`; → `BALLISTAR_CORE_PANELS` in server `member360-panel-registry.ts`. FE typecheck + server build clean (no member360 errors). No registry parity test exists.
- [x] **phase-03-coverage-data-layer** — `services/member360-coverage.ts` (meta-diff + non-time 1-row probe; ready/partial/empty/blocked; rollup; game_id full, prefix flagged `prefixUnsupported`), route `GET /api/workspaces/:id/member360-coverage` in `routes/workspaces.ts`, FE `src/hooks/use-member360-coverage.ts` (+ `findGameCoverage`). Server+FE tsc clean. LIVE-VERIFIED on `local`: ballistar ready, jus_vn ready (all 4 panels modeled+rows), cfm_vn partial (genuine PII gaps device_id/client_ip). Probe-member fix: prefer non-time column (monthly `log_month` 400'd as bare dim).
- [x] **phase-04-coverage-ui** — Admin: `Admin/hub/member360-coverage-panel.tsx` (all-games matrix + dot+label pills + layer-aware dot-stepper resolve pane) inside new `dev-hub-panel.tsx` sub-tabs (Chat-Audit | Data coverage) at `/admin/dev/{chat-audit,data-coverage}`; hub/index.tsx routes to DevHubPanel. End-user: `member360-unavailable-chip.tsx` in both Members views (sample + tiered) when `!hasMember360`; `member360-coverage-notice.tsx` on the 360 page (info banner naming limited surfaces) — pragmatic page-level "partial" state, no panel-subcomponent rewrite. FE tsc clean. SCOPE NOTE: resolve-pane "scaffold draft" surfaced as next-step guidance (defers to onboarding-agent flow), NOT an inline YAML mutation — confirm if you want the live scaffolder here.
- [x] **phase-05-tests-docs** — `server/test/member360-coverage.test.ts` (28 tests: requiredMembers/probeMember[non-time regression guard]/rollupGameStatus) — pass. Full server suite 946/946 green. Parity guard extended to jus/jus_vn (`KNOWN_360_GAMES`) → 10/10. `docs/lessons-learned.md` entry added (vendored cube-dev `:ro` mount → stale-container reload trap; /meta 200 masks unloaded view). code-reviewer verdict: SHIP (no Critical/High; all acceptance criteria verified live). Open follow-ups: async classifier paths (cache/error/prefix branches) untested — hardening, not a defect; live scaffolder deferred to onboarding-agent flow.

## Key dependencies / risks
- **Prod parity:** prod uses prefixed/upstream (kraken) model. Local `user_360.yml` does NOT make
  prod work — prod must expose `jus_*` 360 views upstream. The coverage surface is precisely what
  reveals this gap ("blocked, needs Trino/semantic-layer data").
- **/meta blind spot:** `/meta` only sees *modeled* members; Trino cols not yet in a YAML are
  invisible. Data-probe catches modeled-but-empty; truly-unmodeled cols need a curated hint.
- Product config is duplicated FE `member360-panels.ts` ↔ server `member360-panel-registry.ts`
  (drift-guarded by test) — both must change together.

## Anchors
- FE gate/config: `src/pages/Segments/member360/member360-panels.ts`, `member360-sections.ts`
- FE 360 page: `src/pages/Segments/member360/member-360-view.tsx`
- FE link sites: `src/pages/Segments/detail/tabs/{sample-users-tab,tiered-members-view}.tsx`
- Server: `server/src/services/member360-panel-registry.ts`, `member360-precompute-scheduler.ts`,
  `member360-runner.ts`, `routes/segment-member360.ts`
- Resolver/workspace: `server/src/services/{cube-member-resolver,workspaces-config-loader,workspace-readiness}.ts`,
  `workspaces.config.json`, `workspaces.prod.config.json`, `gds.config.json`
- Existing coverage feature: `src/pages/Settings/{use-metric-coverage,metric-coverage-section,use-workspace-readiness,workspace-readiness-section}.ts(x)`
- Cube view template: `cube-dev-old/cube/model/views/ballistar/user_360.yml`
