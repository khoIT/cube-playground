# Code Review — Pre-agg Readiness + Artifact Validation Sweep

Date: 2026-06-05 17:52 (GMT+7)
Scope: uncommitted working-tree changes vs HEAD `9278183`, excluding `chat-service/runtime/seed/chat-snapshot.json` and `plans/` markdown.
Reviewer: code-reviewer (staff prod-readiness pass)

## Scope
- Changed: docker-compose.prod.yml, docker-compose.devcube.yml, scripts/ensure-cube-api.mjs, docs/deployment-guide.md, docs/lessons-learned.md, server/src/index.ts, server/src/services/workspace-readiness.ts, src/pages/Settings/use-workspace-readiness.ts, src/pages/Settings/workspace-readiness-section.tsx
- New: server/src/{routes/artifact-sweep.ts, services/artifact-collectors.ts, services/artifact-validation-sweep.ts, services/preagg-readiness.ts}, server/test/{artifact-validation-sweep,preagg-readiness}.test.ts, src/pages/Settings/{artifact-sweep-panel.tsx, use-artifact-sweep.ts, __tests__/{artifact-sweep-panel,workspace-readiness-section}.test.tsx}
- ~236 changed LOC + ~1.4k new LOC (code+tests).

## Verification run (this review, not claimed)
- server tests: `vitest run preagg-readiness + artifact-validation-sweep` → 32 passed.
- FE tests: `vitest run artifact-sweep-panel + workspace-readiness-section` → 25 passed.
- server tsc `--noEmit` → 0 errors.
- FE tsc `--noEmit` → 75 errors; none in any new/changed file (baseline 75 confirmed, no regression).
- `docker compose config` validates for both `prod.yml` and the `prod+local+devcube` 3-file overlay; both worker services appear in the service list.

## Overall Assessment
Solid, well-scoped change. The root cause is genuinely addressed (verified against cube-dev source), the readiness/sweep services are fail-open and bounded, SQL is parameterized, the chat DB is opened read-only with a robust path anchor, and tests assert real behavior rather than tautologies. Recommend approve with one nit fix (a plan-artifact reference in a comment). No blockers, no majors.

---

## Checklist findings (with evidence)

### (a) Root cause actually addressed — VERIFIED
- cube-dev model **does** carry rollups: 19 `pre_aggregations` files across `cube-dev/cube/model/cubes/<game>/{active_daily,game_key_metrics,marketing_cost,mf_users,recharge}.yml`. `cros`/`tf` have none → registry exclusion correct (`preagg-readiness.ts:33-34`).
- `cube-dev/cube/cube.js:296` `scheduledRefreshContexts` maps `SUPPORTED_GAMES` to synthetic securityContexts (`userId: refresh:<game>`, `roles:[REFRESH_ROLE]`) that bypass JWT/checkAuth — so the dedicated worker builds **all** games' rollups standalone, exactly as the compose comments claim. Confirmed the worker premise is real, not assumed.
- Registry measure+timeDimension pairs all map to actual rollup members: `recharge.revenue_vnd`/`recharge_time` (recharge.yml:161 rollup), `mf_users.user_count_approx`/`install_date` (mf_users.yml:302 rollup), `active_daily.dau`, `game_key_metrics.cost_vnd`/`report_date`, `marketing_cost.cost_vnd`/`log_date` all present. A `granularity:day` probe on these will match the rollup and trip the partition-not-built path when unbuilt — the classification is meaningful, not a no-op that always reports "built".
- **Minor:** the comment at `preagg-readiness.ts:34` cites the path `cube-dev/cube/model/cubes/{cros,tf}/*.yml` but the actual layout is per-game (`cubes/<game>/<cube>.yml`); the bare-cube path doesn't exist. The exclusion is still correct; the path in prose is slightly misleading. (nit)

### (b) Compose correctness — VERIFIED, no blockers
- Worker env parity with `cube_api`: same Trino vars (`CUBEJS_DB_*`), same `CUBEJS_API_SECRET`, same `CUBEJS_CUBESTORE_HOST` (prod: `cubestore`; dev: `cubestore_dev`) → writes/reads the same store. Good.
- `CUBEJS_REFRESH_WORKER` pinned literal `"true"` on workers and **literal `"false"`** on both serving instances (prod.yml ~line 162, devcube.yml line 46) — no longer `${...}`, so an env meant for the worker can't flip the API. This is the correct hardening and matches the updated lessons-learned entry.
- No port conflicts: neither worker publishes ports (`# No ports`). Prod worker has a `/readyz` healthcheck (internal :4000) mirroring `cube_api`; dev worker has none (acceptable — dev watchdog covers the serving instance).
- Prod worker uses the mounted `docker/cube-entrypoint-patched.sh` (exists, executable); dev worker uses an inline `sed` entrypoint (colima single-file bind-mount denial is documented). Both valid for their host constraints.
- `ensure-cube-api.mjs` adds `cube_refresh_worker_dev` to the `up -d` list (line ~145) but **not** to the running-check / restart branch — intentional and correct: the watchdog only health-probes the serving instance, and `up -d` is idempotent so the worker is (re)started alongside without being restarted on every API wedge.
- **Minor:** prod worker sets `AUTH_API_URL: http://server:3004` + `AUTH_INTERNAL_SECRET` but the comment says refresh contexts are synthetic and never hit checkAuth; the dev worker correctly sets `AUTH_API_URL: ""`. The prod auth bridge is dead config "for parity." Harmless, but it's config that implies a dependency that doesn't exist. (nit)

### (c) No regression to readiness consumers / event-loop hazards — mostly clean, one flag
- Response shape is **additive**: `WorkspaceReadinessReport` gains `preaggs` (server `workspace-readiness.ts:87`; FE `use-workspace-readiness.ts` mirror). Existing fields untouched; existing consumers unaffected.
- Fail-open verified: `probeOne` never throws (catches → `error`/`unbuilt`); `computePreaggReadiness` resolves even when every probe rejects (test `never throws when every probe rejects`). The non-game_id branch short-circuits with no /load.
- Concurrency bounded: `mapWithConcurrency(tasks, 2, …)` is a true fixed-pool (`bounded-concurrency.ts`), order-preserving, empty-list-safe. Test asserts max-in-flight ≤2. 60s cache keyed by `workspace.id` (shared across owners — correct, pre-agg state is not owner-specific).
- **MAJOR-watch (not a blocker, flag):** the readiness GET auto-fetches on mount (`use-workspace-readiness.ts:122` `useEffect → refetch`), and `computeWorkspaceReadiness` now runs `computePreaggReadiness` in `Promise.all` alongside `readGamesReadiness`. On a cold 60s cache this fires `5 cubes × N games` real **/load** calls (≈25–30 for 6 games) automatically whenever the Settings readiness tab is opened. `lessons-learned.md` explicitly names "the readiness sweep firing dozens of concurrent per-game /load queries" as the prior wedge trigger. Mitigations here are real and adequate (bounded at 2, 60s cache, partition-error returns before data scan, peak in-flight = sequential meta + 2 probes ≈ 3), so this is **acceptable** — but it converts a previously meta-only auto-route into one that auto-issues bounded /load against the documented-sensitive cube. Worth a conscious sign-off; consider gating the pre-agg probe behind an explicit refetch (like the artifact sweep) if the local cube proves fragile under it.

### (d) Sweep correctness — VERIFIED
- Dashboards/segments **never** issue /load: `classifyPersistableGroup` reads `persistedStatus`/`persistedErrorMsg` only; live probe path is chat-only (`classifyChatGroup`, gated on `live && art.game`). Tests assert `mockLoad not called` for every dashboard/segment case incl. summary/owner-scoping. Confirmed.
- Owner scoping correct: collectors filter `WHERE owner = ? AND workspace = ?` (dashboards via join on `d.owner`/`d.workspace`; segments on `owner`/`workspace`; chat on `cs.owner_id = ?`). Test `owner scoping` proves bob's tile is excluded for alice. Indexes exist (`idx_dashboards_workspace_game_owner`, `idx_segments_workspace_game_owner`, chat join on PK) → no N+1, one prepared query per artifact type.
- SQL injection-safe: all three collectors use `db.prepare(...).all(params)` with bound `?` placeholders; no string interpolation of user input. Verified.
- Chat DB read-only + fail-open: `new Database(path, { readonly: true })`; `openChatDb` returns null on failure → `chatArtifacts:[]` + note. DB closed in `finally`. Path anchored via `import.meta.url` (not cwd) with `CHAT_DB_PATH` override — default `…/chat-service/runtime/chat.db` exists. Schema confirmed: `chat_turns.artifacts_json`, `chat_sessions.owner_id`, join on `session_id` all real; `artifacts_json` is an array of `QueryArtifact{id,title,game,query}` (chat-service/src/types.ts:44) — collector parses it correctly and marks query-less entries malformed.
- Malformed JSON handled at every tier: dashboard/segment collectors catch `JSON.parse` → `malformed:true` → `runtime-error` without throwing (tests `malformed query_json → runtime-error, sweep continues` for both); chat collector skips malformed turn JSON and flags per-artifact missing query. Table-absent → empty array (defensive try/catch in collectors).
- Live probe is bounded ≤2, limit:1, dateRange shrunk to yesterday; only runs for static-passing chat artifacts with a resolvable game ctx. Correct.

### (e) FE — VERIFIED
- Design tokens only: grep for `#hex` in `artifact-sweep-panel.tsx`, `use-artifact-sweep.ts`, `workspace-readiness-section.tsx` → **zero** raw hex. All colors via `var(--success-soft/ink)`, `--warning-*`, `--destructive-*`, `--muted-*`, `--brand`, `--radius-*`, `--font-sans`. Matches design-guidelines mandate.
- No auto-fetch on mount for the sweep panel: `use-artifact-sweep.ts` exposes `run()` only (no `useEffect`); panel calls it from the button `onClick`. Test `does NOT fetch on mount` asserts `apiFetchMock not called`. Confirmed.
- No new tsc errors (75 baseline; none in changed files).

### (f) Tests honest — VERIFIED
- Real behavior, not tautology: sweep tests seed a real in-memory SQLite with **all migrations applied**, insert real dashboard/segment rows, and assert classification end-to-end through `runSweep`. Only `cube-client`/`resolve-cube-token`/`games-config` are mocked (boundary mocks). The `better-sqlite3` mock intercepts only `readonly:true` opens (chat DB) to force fail-open while leaving the test DB real — legitimate, and it actually exercises the chat fail-open path (`note` matches `/chat/i`).
- preagg tests drive `computePreaggReadiness` with a mocked `loadWithCtx` and assert built/unbuilt/error classification per message shape, the ≤2 concurrency invariant (instrumented counter), and the TTL-cache no-new-calls path. These assert the discriminating logic, not mock identity.
- Route tests inject real HTTP through `buildApp()` and assert 400/200 + body shape + zero /load.
- No false-pass smell found (no `expect(true).toBe(true)`, no over-mocking of the unit under test).

### (g) Plan-artifact references — ONE violation
- **NIT (rule violation):** `server/src/services/preagg-readiness.ts:82` comment reads *"Exported so Phase 04 can reuse without re-declaring the string."* — references a plan phase number, which `review-audit-self-decision.md` §5 forbids in code comments (phase headers get renumbered → stale). Reword to describe the why, e.g. *"Exported so the artifact-validation sweep can reuse this predicate without re-declaring the string."*
- All other new/changed code + test names are clean (grep for `Phase|P0x|F<n>|§|audit A<n>|red-team` → only the one hit above).

---

## Findings list (severity-tagged)

| # | Sev | File:line | Finding |
|---|-----|-----------|---------|
| 1 | nit | preagg-readiness.ts:82 | Comment references "Phase 04" — plan-artifact ref forbidden in code; reword to the functional reason. |
| 2 | minor | use-workspace-readiness.ts:122 + workspace-readiness.ts:281 | Readiness GET auto-fetches on mount and now triggers bounded /load pre-agg probes (~25–30 cold) on the cube the lessons-learned doc flags as fan-out-sensitive. Bounded(2)+cached(60s) makes it acceptable; flag for conscious sign-off / consider explicit-refetch gating if the local cube proves fragile. |
| 3 | nit | preagg-readiness.ts:34 | Excluded-cube path comment `cubes/{cros,tf}/*.yml` uses wrong layout (actual is `cubes/<game>/<cube>.yml`); exclusion itself is correct. |
| 4 | nit | docker-compose.prod.yml (cube_refresh_worker) | `AUTH_API_URL`/`AUTH_INTERNAL_SECRET` set "for parity" but comment says refresh contexts never hit checkAuth → dead config implying a non-existent dependency. Dev worker correctly sets `AUTH_API_URL: ""`. |

## Positive observations
- Literal-pinned `CUBEJS_REFRESH_WORKER` on serving instances is the right fix and is explained in-place.
- Three-tier "cheapest-first" sweep design (static /meta check → persisted-status read → opt-in live probe) keeps the default path /load-free; dashboards/segments are provably never live-probed.
- Read-only chat DB open + `import.meta.url` path anchor + fail-open is exactly the robustness shape the lessons-learned cwd-relative-sqlite entry warns about.
- Bounded-concurrency reuse (not a new ad-hoc pool) and a TTL cache mirroring the existing readiness cache — consistent with codebase conventions.
- Tests seed real migrated SQLite and assert real classification; boundary-only mocking.

## Unresolved questions
1. Finding #2: is auto-firing bounded pre-agg /load probes on every Settings-readiness mount an accepted posture, or should the pre-agg probe move behind an explicit refetch like the artifact sweep? (Author/lead decision — not a code defect.)
