# Changelog

Significant changes to the cube-playground app, newest first.

## 2026-06-11 — Pre-agg the heavy segment composition/retention cards (approx)

Made the unscoped + rollup-aligned segment insight cards serve from CubeStore instead of cold Trino. The heavy composition/retention cards (lifecycle, payer-tier, country, platform, install trend, paying-rate) were full-cohort `count_distinct` group-bys that timed out on a cold cube; a fresh-looking segment (e.g. `High value`, filters `[]`) had 19/31 cards silently failing. After: that segment refreshes in ~1s with those cards routed.

- **New dedicated rollup** `user_composition_batch` (+ `user_composition` lambda) on every game's `mf_users` — measures `user_count_approx` + `paying_users_approx`, dims `country / media_source / os_platform / payer_tier / lifecycle_stage / is_paying_user`, time `install_date` (year-partitioned). Kept **separate** from `ltv_by_install_cohort` so its shape can evolve without rehashing the flagship LTV rollup.
- **New measures** `paying_users_approx` (count_distinct_approx + recharge filter) and `paying_rate_approx` (= approx components) on all 7 `mf_users`. The shared `mf-users-hub` preset cards now use the approx measures for the composition/trend/paying-rate cards (≈±2% HLL — fine for bars/trends); headline KPIs + non-routing cards (campaign / last-country / first-active / first-recharge trends) stay exact.
- **Scope/limits**: only unscoped segments and those whose predicate filters on rollup dims (`is_paying_user`, `payer_tier`, `media_source`, `lifecycle_stage`) route. Segments filtering on continuous columns (`lifetime_txn_count`, `ltv_30d_vnd`, `days_since_last_active`) can't be served by a dimensional rollup and still hit Trino (bounded by the widened card-phase budget). The 4 trend/high-card cards above need their own rollups (follow-up).
- **Deploy note**: adding the approx measures rehashes the cube's existing pre-aggs, so on rollout the LTV cards rebuild their current-year partition; during that window they serve last-good (the card cache preserves it) and the ops monitor flags `degraded` until the reseal completes.

## 2026-06-11 — Card-failure detection in the segment-refresh monitor

Closed a blind spot where a segment read `healthy` while its KPI cards had been failing to refresh for hours. Root cause: the card cache's last-good preservation flips a card that previously succeeded but now errors back to `status='ok'` (so it keeps serving the stale value) and records the failure only in the `error` breadcrumb — so the monitor's `status='error'`-only count scored it green. Live DB had 6 such segments (one with 19/31 cards failing) all reading healthy. Tests: server ops + route + refresh suites green (32); FE ops suites green (8); typecheck clean.

- **`degraded` now keys on the error breadcrumb (`error IS NOT NULL`)**, not `status='error'` — counting both never-succeeded cards and those serving last-good. New `failingCards` on each ops row; `cardsStale` flags the serving-last-good case (green by status alone). The ops payload + wire type carry `failingCards` + `newestCardAgeMs` (display-only).
- **Rejected a `fetched_at`-age signal**: the cache deliberately doesn't bump `fetched_at` when a re-verified card's value is unchanged (dedup for snapshot stability), so a healthy-but-stable cohort would false-positive. The breadcrumb is the precise signal — it reflects the last *attempt's* outcome, with no false flag on stable cards.
- **UI** — the row's card tally shows `N/total failing` (destructive when some are hard-down, warning when all serving last-good) and the expand panel lists every failing card + its latest error, with a "serving last-good" callout. The known card-runner cause is the per-card Cube `/load` timeout on heavy full-cohort aggregations (retention/composition cards over large `mf_users` predicates) against a cold local Cube.

## 2026-06-11 — Fail-soft segment identity resolution

Distinguished the two reasons a segment's uid identity can fail to resolve so a transient blip no longer masquerades as a dead segment. Tests: new fail-soft refresh test + existing identity/refresh suites green.

- **`resolveIdentityDetailed()`** returns a discriminated result: `no-uid-dim` (Cube `/meta` read fine, cube genuinely exposes no uid-like dimension — structural) vs `introspection-failed` (couldn't introspect: Cube unreachable / wrong ctx / timeout — transient).
- **`refresh-segment`** now branches on it: `no-uid-dim → broken` (unchanged; set a mapping in Settings), `introspection-failed → stale` + retry. A transient identity failure self-heals on the next cron tick and surfaces in the ops console as `serving_stale` instead of a sticky `broken` that needed a code deploy to clear.
- `resolveIdentityField()` retained as a `string | null` wrapper, so preview / member-pull callers are unchanged.

## 2026-06-11 — Segment refresh ops console + wedge watchdog

Added a sys-admin "Segment Refreshes" tab (sibling to "Pre-agg Runs") that monitors the **gateway's segment-refresh cron** (path B — per-cohort + KPI-card recompute), and a runtime watchdog that self-heals segments wedged mid-refresh. Plan: `plans/260610-1923-segment-refresh-ops-console/`. Tests: 22 new server tests + 8 new FE tests; server cron/refresh + FE hub suites green; FE/server typecheck clean on touched files.

- **Two signals nothing surfaced before** — `wedged` (a row stuck in `refreshing`; the queue is in-memory so any refreshing row at rest is an orphan that `listDueSegments()` skips forever) and `degraded` (cohort refreshed fine but K-of-N KPI cards are cold-failing — kept invisible by card-cache last-good preservation). Full derived taxonomy: healthy / due / in_flight / wedged / serving_stale / broken / degraded — computed, no new status column.
- **Wedge watchdog** (`SEGMENT_REFRESH_WATCHDOG_ENABLED`, default on) — each cron tick reconciles any `refreshing` row older than `max(cadence, SEGMENT_REFRESH_WEDGE_FLOOR_MIN=10min)` back to `stale`, so the next tick re-runs it. Closes the no-restart gap the boot-time reconcile can't reach on a long-lived gateway. Same single-id reconcile (`reconcileSegmentRefreshing`) backs the manual **Unstick** action.
- **Server** — `GET /api/segment-refresh/ops` (cron heartbeat via new `getLastTickAt()` + queue depth + per-segment derived health) and `POST /api/segment-refresh/:id/unstick` (admin-gated, idempotent). Read-only over `segments` + `segment_card_cache` except the unstick write. Derivation isolated in a pure helper (`segment-refresh-ops.ts`).
- **UI** — `/admin/segment-refreshes`: cron heartbeat strip (last tick, queue depth, wedged/degraded counts, watchdog state), alert-sorted segment table with status chips + per-card ok/error tally + expand-to-erroring-cards, and per-row **Refresh now** / **Unstick** actions. Hub-nav badge raises an "N alert" tag for wedged+degraded.
- **Per-instance by design** — reports the gateway that served the request (its own SQLite); the `:3000` host and `:11000` docker gateways each have their own DB + cron. Cross-ref `docs/query-paths-and-service-topology.md` §7/§8.

## 2026-06-10 — Pre-agg run history console + hourly all-games refresh cadence

Made the local refresh worker sweep **hourly across all games** (a full sweep is a heavy Trino+CubeStore job) and added a sys-admin "Pre-agg Runs" tab to observe those sweeps. The headline operator signal is `stale_serving` — a rollup whose latest refresh failed but whose old cache is still answering warm, so dashboards look green while data silently goes stale. Plan: `plans/260610-1838-preagg-run-history-console/`. Tests: 56 new server tests + full suite green; code-review APPROVED_WITH_MINORS (fixed).

- **Worker cadence** — `CUBEJS_SCHEDULED_REFRESH_TIMER` default 300s → 3600s, scope all games (`CUBE_REFRESH_GAMES` empty). Per-rollup `refresh_key` still governs actual rebuild cadence. A mid-sweep failure never wipes cache (versioned-table swap is atomic), which is exactly why failures need surfacing.
- **Telemetry collector** (`PREAGG_COLLECTOR_ENABLED`-gated) — reads the refresh-worker's logs via a read-only Docker socket mount on the server, parses hourly sweeps + failures, and merges them with the per-game serveability probe into a four-state outcome taxonomy: `sealed` / `stale_serving` / `failed` / `unbuilt`. Degrades to probe-snapshot mode when the socket is absent (CI/prod-without-opt-in).
- **Attribution limit (surfaced, not hidden)** — worker logs carry no game/security-context, so failures are rollup-level and over-warn across games sharing a cube; the UI notes this. Successful seals are trace-only and inferred from probe + absence-of-error.
- **UI** — `/admin/preagg-runs`: live serveability strip, amber stale-serving headline banner, KPI row with a flagged stale-serving card, and an expandable sweep history (per-cube outcome chips grouped failures-first). SQLite-backed (`preagg_sweep` + `preagg_sweep_item`, migration 045, 30-day retention).

## 2026-06-10 — cfm_vn metric catalog: Trino-grounded + fast/cold/blocked taxonomy

Re-grounded the business-metric catalog for cfm_vn so every listed metric resolves against modeled cubes and the common daily slice routes to a CubeStore pre-aggregation. Audit found only 20/57 presets resolving with data; recovered ~16 by repointing formulas to existing marts, added 12 event-cube exploration metrics, and labeled the rest cold or blocked instead of dropping them. Plan: `plans/260610-1446-cfm-vn-metric-catalog-fast-query/`. Tests: server + frontend + chat-service suites green; code-review clean after fixes.

- **⚠️ Revenue value shift (not a regression):** `revenue`/`gross_bookings`/`arppu`/`arpdau` were repointed off `recharge.revenue_vnd` (raw `iamount`, ~15× inflated by unbridged test traffic) to `user_recharge_daily.revenue_vnd_total` (bridged). cfm_vn revenue figures drop to the correct value (e.g. ~710M vs ~11B on 2026-06-01). Monitoring (anomaly detector, LiveOps KPI board, daily-health) already used the correct measure and is unaffected.
- **Recovered metrics** — acquisition/marketing/payment metrics repointed from unwired `mf_users.*` to `game_key_metrics.*` (+ 6 new post-agg ratio measures, `nnpu`/`iap_rev` in the daily rollup); paying retention to `new_user_retention`. Deferred as draft pending semantics: `ltv`/`ltv_30` (cohort vs calendar), `roas_07` (period vs D7), `organic_installs`/`paid_installs` (need filtered measures).
- **12 new exploration metrics** — diamond economy, gacha, onboarding tutorial, session time, IAP revenue (all backed by existing event-cube rollups).
- **Taxonomy** — per-game `meta.serving` (cold) + `meta.applicability` (blocked) annotations; `?filter=available` excludes blocked + broken-ref while keeping resolvable drafts; Catalog surfaces cold/blocked badges. 12 structurally-absent metrics (funnel, concurrency, roles) kept as blocked stubs, not deleted.
- **Agent surface** — starter questions, chat-service templates, and glossary synonyms rebuilt to fast metrics only (`gross_bookings` folded as a `revenue` alias). New resolution-baseline eval harness (`chat-service/test/metric-resolution-eval/`) freezes pre-change agent resolution; cross-game master list + per-game rollout template added under `docs/`.
- **Verification** — pre-agg routing confirmed via compiled SQL for all fast metrics; warm-latency + `game_key_metrics` data presence are prod-confirm items (local batch pre-aggs >100k rows can't seal without an export bucket).

## 2026-06-10 — jus_vn VIP-care playbook coverage unlock (6/21 → 13/21 enabled)

Expanded jus_vn VIP-care playbook coverage from 6 to 13 enabled by adding 4 new Cube YAML marts in the sibling `cube-dev` repo. No server/client code changes, no registry edits — the per-game availability system automatically resolved verdicts from live Cube `/meta` member presence. Added `user_recharge_rolling.yml` (spend-spike, spend-drop), `user_active_rolling.yml` (session-drop), `user_gameplay_daily.yml` (top-leaderboard, major-achievement), and `etl_prop_flow.yml` (rare-unlock, collector-FOMO partial). Leaderboard ranking uses role_level + LTV tiebreak (fighting_power is 100% NULL in jus). Plan: `plans/260610-0000-jus-vn-playbook-coverage-unlock/`. Tests: 59 care-server tests all pass; live Cube /meta, sweep, and API surface validated on 2026-06-08 anchor.

- **4 new jus marts** — added to `cube-dev/cube/model/cubes/jus/`: `user_recharge_rolling.yml` (unlocks PB03/04), `user_active_rolling.yml` (unlocks PB15), `user_gameplay_daily.yml` (unlocks PB06/09), `etl_prop_flow.yml` (unlocks PB07/11 as partial). Honest semantic: jus leaderboard ranks by progression-level + lifetime-spend (cross-game member `ladder_rank` reused, cfm = PvP score, jus = progression+LTV).
- **Availability auto-flip** — no registry changes. Each mart exposes the exact logical members the playbooks' `dataRequirements` expect; the shared per-game `/meta` probe flips verdicts with zero FE/server edits.
- **Cohort validation** — all 9 newly-available playbooks have non-empty cohorts: spend-spike 1,324; spend-drop 623; session-drop 237; top-leaderboard 10; major-achievement 1. Calibration-free: cfm-tuned qualification floors (₫500k spend, 30h session) produce sane jus cohorts.
- **Unavailable playbooks (unchanged)** — no jus source or fabrication: 05 payment-fail, 08 rank-drop, 10/17 guild, 12 gacha, 13 sentiment, 16 ticket, 21 birthday. Cross-game safety verified (cfm coverage 12+5 unchanged).

## 2026-06-09 — Close the CS demo-care-loop (persist treatment, claim/assign, human-closed KPI, export, activity, reseed)

Completed the CS console care loop from read-only artifact to a true interactive demo: VIP 360 now persists real treatment actions, supports claim/assign/dismiss workflows, human-closed KPI outcome (met/missed) with rollup ROI stats, CSV case export, rolling 24h activity tracking, and guarded full-game reseed. Plan: `plans/260609-1813-cs-demo-care-loop/`. Tests: 5 phases, 40+ new FE tests; all green.

- **Persist member-360 treatment** (`cs-member360-derive.ts`) — real timeline from ledger, real recommended action from top open case. "Mark treated" form (channel/action/notes) → `PATCH /api/care/cases/:id` → refetch. No more mock data.
- **Claim / assign / dismiss** (`cs-case-actions.ts`) — claim-to-me / owner chip inline edits, dismiss-with-reason (reason code encoding). FE routes to existing `PATCH /api/care/cases/:id` (assignee/status). Buttons on queue and rail.
- **Human-closed KPI outcome** — treated cases expose "Close · KPI met" / "Close · KPI missed" → `patch{status:'resolved', outcome}`. New additive `kpiMetRate` stat (kpi_met / closed-with-outcome) in portfolio alongside unchanged `attainmentRate`. Outcome badge on resolved rows.
- **CSV export** (`care-queue-csv.ts`) — full un-paginated queue download (VIP, playbook, status, outcome, channel, dates, notes). Link on Monitor.
- **Activity strip** (`/api/care/activity`, `cs-activity-strip.tsx`) — new GET route (rolling 24h treated/dismissed/resolved counts + recent events, game-scoped). Monitor left sidebar strip showing hourly metrics (GMT+7 display).
- **Guarded reseed** (`POST /api/care/cases/reset?game[&resweep=true]`) — new `clearCases(gameId, workspaceId)` store fn + route. Editor/admin write-gated. Confirm dialog names game + count. Re-sweep OFF by default (optional checkbox). Pre-check `isSweepInFlight` → 409 before any delete.

## 2026-06-09 — VIP Care Playbook Console (21-playbook care ledger + CS monitor + authoring)

Shipped a stateful CS console for the 21-playbook VIP Care Program targeting cfm_vn + jus_vn: a playbook monitor (status + case count), action queue (sorted by fatigue + priority), per-VIP care history (Member-360 Care tab), and a playbook builder (threshold/predicate override authoring). Single source of truth is the `care_cases` ledger with data-calibrated thresholds and per-(game×playbook) availability gating (playbooks grey out when Cube members aren't modeled). Plan: `plans/260608-2152-vip-care-playbook-console/`. Tests: 54 server + 55 FE (109 total); tsc clean.

- **Playbook registry** (`server/src/care/playbook-registry.ts`) — seeded 21-playbook canonical config (condition predicate, watched metric, KPI, channel, priority, dataRequirements). `threshold-rule.ts` compiles threshold rules (abs/tierStep/event/percentile/ratio) → cohort predicates. `playbook-merge.ts` stacks seed ⊕ DB overrides (threshold tune, supplemental AND/OR predicate, custom playbooks). Per-game availability gating via `availability.ts` + Cube `/meta` probe (missing member ⇒ unavailable).
- **Care-case ledger** (`care_cases` migration 037) — single source of truth. `care-case-store.ts` CRUD, `care-case-engine.ts` membership diff + trigger eval + by-VIP dedup, `care-case-sweep.ts` orchestrator (Cube cohort injected, unit-tested headless). Idempotent case open, condition-lapsed tracking, contact history.
- **Contact governance** (`care_governance` migration 038) — org-wide fatigue rules (max 1 proactive/VIP/24h, per-channel cooldown defaults: call 7d·Zalo 48h·in-game/push 24h). `fatigue.ts` window-based fatigue + per-channel cooldown. `kpi-eval.ts` auto-resolves on numeric KPI threshold. `cao`-priority cases hitting cap surface as "blocked — override?" (human decision).
- **CS Monitor** (`/dashboards/cs`) — 21-playbook grid: seed name, status (available/unavailable), active case count, case rate, last trigger. Header: "+ New playbook" CTA, game selector, refresh.
- **Action Queue** (`/dashboards/cs/queue`) — paginated, sortable case list (VIP name, playbook, fatigue window, contact history). Assignee pull-pool + AM affinity. Click → case detail drawer.
- **Playbook Builder** (`/dashboards/cs/playbooks/new` + `/:id/edit`) — four-section form: name/description, threshold rule (rule-type + value), supplemental AND/OR predicate (reuses Segments builder), enable/disable. Editor/admin write, viewer read-only. Mutation id-routing via `playbook-mutation-target.ts` (seed→POST base_id, override→PATCH override-row-id) fixes custom-edit 404 + override mis-targeting.
- **Member-360 Care tab** (Member 360 page) — auto-opens on VIP qualification. Case timeline (playbooks triggered, dates), governance status (fatigue window, blocked-override flag), contact history, action affordances.
- **API & routes** — all `/api/care/*` in `PROTECTED_PREFIXES` (editor/admin write-gated). `GET /api/care/playbooks?game=`, `/cases`, `/cases/by-vip`, `/cases/vip/:uid`, `PATCH /cases/:id`. `POST/PATCH/DELETE /care/playbooks` (CRUD on overrides), `GET/PUT /care/governance`, `GET /care/fatigue`.
- **Migrations** — `036-care-playbooks.sql`, `037-care-cases.sql`, `038-care-governance.sql`, `039-care-playbook-supplemental-predicate.sql` (additive, forward-only).
- **Deferred to live** — cron scheduling + live trigger eval (runCaseSweep + Cube cohort fetcher implemented, only scheduler tick remains); live threshold calibration (calibrate.ts CLI reconciles registry member names against `/meta`, seeds concrete percentile/ratio values); percentile-rule cutoff computation (no seed uses percentile yet); Phase 4 (cfm gameplay-daily mart — when live, 6 NHÓM-2 playbooks flip unavailable→available with zero FE change).

## 2026-06-08 — Member 360 data-coverage surface + jus_vn enablement

Shipped queryable per-game/per-panel Member 360 data-coverage evaluator (ready/partial/empty/blocked) accessible via admin UI at `/admin/dev/data-coverage` + end-user chips/notices on Members tab + a draft-view scaffolder for blocked games. Enabled jus_vn Member 360 with new `cube-dev/cube/model/views/jus/user_360.yml` (4 core + 3 audience views). Tests: 33 new server tests (28 coverage + 5 scaffolder), full server suite 953/953 green; parity guard extended to jus/jus_vn.

- **Coverage classifier** (`server/src/services/member360-coverage.ts`) — hybrid /meta-diff + 1-row probe per game/panel. Returns `{ ready, partial, empty, blocked }` status; game-level rollup; workspace-aware (game_id fully eval, prefix workspaces flagged `prefixUnsupported`). Fail-open.
- **Coverage route** (`GET /api/workspaces/:id/member360-coverage`) — game list with per-panel statuses + missing members; 60s cache; mirrors the `/readiness` route.
- **Admin UI** (`/admin/dev/data-coverage`) — new sub-tab in dev-hub-panel: all-games matrix (rows=games, cols=360 surfaces, cells=status dots; `—` = panel not in that game's 360) + status legend; click a cell → layer-aware Trino→Cube YAML→product dot-stepper resolve pane. Manual refresh.
- **Draft-view scaffolder** (`server/src/services/member360-view-scaffolder.ts`, `GET /api/member360/scaffold/:game`) — for a blocked/partial cell, generates a draft `views/<game>/user_360.yml` from the core-360 panel registry (view→base-cube map; includes = members the panels read). Read-only: resolve pane offers Generate / Copy / Download (no disk write — placement is a human, git-tracked step).
- **End-user notices** — unavailable-chip on the Members tab when a game has no 360 config; partial-coverage info banner on the 360 page naming the limited surfaces.
- **jus_vn Member 360** — New `views/jus/user_360.yml` (4 core + 3 audience views, mirrors ballistar shape). Config entries in `member360-panels.ts`, `member360-sections.ts`, server `member360-panel-registry.ts`. Live-verified after Cube container restart (stale `:ro` mount — see lessons-learned).

## 2026-06-05 — Per-member 360 page (live Cube, config-driven)

New route `/#/segments/:id/members/:uid`: clicking a member in a segment's Members tab opens that member's full 360, rendered live from Cube. Plan: `plans/260605-1200-per-member-360-page/`. Builds on the already-ported cfm `user_360.yml` substrate (no re-port). Tests: 17 new FE (`member360-data-layer`); full Segments suite 161 green; build clean.

- **Config-driven panel registry** (`src/pages/Segments/member360/member360-panels.ts`), per game: **cfm** = full set (profile + roles/devices[PII]/ips[PII] + daily/monthly timelines + 10 lazy FPS event-stream "Behavior" panels); **ballistar** = core subset (profile + timelines + transactions). Built ballistar too because every existing segment is ballistar — keeps the feature reachable. cros/tf are later config-only adds.
- **Single-member live hook** (`use-member-cube-query.ts`): reuses the proven `cube-member-resolver` physicalize/logicalize + cube client + a 3-concurrency cap; sends the query verbatim (no segment slice filters, unlike `useSegmentCubeQuery`).
- **Guardrail-safe behavior section**: 1M–1.3B-row `etl_*` panels query only on expand, each bounded by an `inDateRange` filter on `<view>.log_date` (preset 7/14/30d, all ≤ cube.js `MAX_RANGE_DAYS=31`); playerid bridge resolves the user's `role_id`s once (`user_roles_panel`) then filters `playerid IN role_ids`; a test asserts the registry's behavior views ⊆ `BEHAVIOR_VIEWS`.
- **Dashboard layout** (modeled on the `cfm-user360` reference, on cube-playground tokens): gradient hero (badges + headline pills), Monetization tile grid, Profile/Acquisition key-value columns, Journey (milestone timeline + level-progression line + daily-recharge bar via recharts), and a tabbed Details section (Roles/Behavior/Combat/Devices/IPs/Activity/Recharge). Section config in `member360-sections.ts` (per game); whole top of page is one `user_profile` row.
- **Game pinning**: `useCubejsApi` gained an optional `gameOverride` so the page queries its segment's game (`x-cube-game`) regardless of the global game selector — the proxy mints the per-game schema JWT from that header.
- **Reconciled live**: user `3384327107741499392` (cfm_vn) matches the reference dashboard — LTV 25,448,000₫, max level 128, active days 170, whale/hardcore/OT. Members pre-classified dimension-vs-measure from the cube YAMLs to avoid silent-empty.

## 2026-06-05 — Multi-game Cube model port (cfm full 360 + cros + tf)

Ported the upstream prod Cube semantic layer (`kraken/cube`) into the local `cube-dev` submodule so local can serve the `cfm-user360` dashboard plus cros/tf 360s. Plan: `plans/260604-2317-cfm-vn-cube-model-full-port/`. Verified live against Trino + compiled green on the dev cube-api (cfm 46 objects, cros/tf 27 each; ballistar unchanged → no regression); `/load` returns reconciled data for all 6 dashboard views (e.g. `user_profile.ltv_vnd` matches Trino). vga deferred (different `iceberg` catalog).

- **cfm**: added `user_roles`/`user_devices`/`user_ips` + monthly rollups + the full `etl_*` event-stream set; replaced hand-built `economy_flow`/`gameplay_match`/`onboarding_tutorial`; added `engagement_segment` to `mf_users`; new `views/cfm/user_360.yml` (~26 views). Kept richer local core cubes (WAU/trailing measures, SDK recharge dims) — field-merged, not overwritten.
- **cros + tf**: full 12-cube 360 clones + `views/<game>/user_360.yml`, bare-named.
- **cube.js**: `GAME_SCHEMA` += cros/tf; ported the 31-day behavior-log `queryRewrite` guardrail (bare `etl_*`, fail-closed) + `continueWaitTimeout:25`. Dev `auth-users` allowedGames extended (incl. `playground` service account) for cros/tf.
- Naming: bare cube names (local convention) — the FE member-resolver physicalizes to `cfm_*` against prod. See `docs/lessons-learned.md` → "Porting a prod Cube model into a local tenant".

## 2026-06-04 — Concept Map (standalone cross-layer node graph)

Shipped the deferred standalone concept map as a new Data Model subtab at `/catalog/data-model/concept-map`. Renders all 4 concept layers — data-model fields · business metrics · glossary terms · app segments — as a node graph (reactflow), with focus-scoped cross-layer edges. Closes the documented Schema Cartographer gap: a non-`data_model` `?focus=` (e.g. `business_metrics/dau`) now highlights a node, because every layer has node cards. Plan: `plans/260604-0058-unified-concept-fabric-map-page/`. Tests: 30 new FE (use-concept-graph, use-focus-edges, concept-node, build-layout, base-node, concept-map-page); full Catalog suite 259 green.

- **Additive ConceptNode index** (`src/pages/Catalog/concept-map/`). NEW `useConceptGraph` enumerates nodes from the 4 existing list sources (`useConcepts`, `useBusinessMetrics`, `listGlossary`, `segmentsClient.list`) keyed by the same namespaced refs the relations endpoint emits. Deliberately separate from the cube-FQN-bound `useCartographerIndex` (which is NOT modified) — and disambiguates cube-YAML segments (`field` layer = measures+dimensions only) from app `segments` (`appSegment`).
- **Focus-scoped lazy edges.** Only the focused node fetches edges, via the module-cached `useConceptResolution` (`useFocusEdges`). No whole-graph fan-out, no N+1, no new server endpoint.
- **reactflow canvas** (`^11.11.4`, lazy-loaded so its ~45kb is code-split out of the main Catalog bundle). Deterministic 4-column layout (pure `build-layout.ts`, no auto-layout engine), per-layer cap ~50 + "show N more", custom token-styled node cards (new dedicated `--layer-*` tokens), keyboard-operable nodes, focus dims unconnected cards. reactflow's default palette overridden via `concept-map.css`.
- **URL-backed focus + cross-nav.** `?focus=` round-trips for all 4 namespaces (reuses the Cartographer's exported `parseFocusRef`, no fork); search narrows across layers and clears focus when it hides the focused node; layer pills gate whole columns; each node deep-links out to its existing detail route (metric/term/segment).

## 2026-06-03 — Per-User Isolation & Sys-Admin Hub

Made the app properly multi-user on the already-shipped DB-authz spine: per-user segment isolation, a full activity-telemetry event spine, and a tabbed sys-admin hub with fine-grained per-user controls + observability. Plan: `plans/260603-1439-workspace-isolation-and-sysadmin-hub/`. Suites green: server 718, FE 1618.

- **Segment isolation.** Enforce the existing nullable `segments.visibility` column (`028-segments-visibility.sql`): `personal | shared | org`. LIST + by-id routes now filter via `WHERE COALESCE(visibility, 'personal') IN (<allowed>)`. **Behavior change (intentional):** legacy segments with NULL visibility become owner-only — teammates lose visibility of segments they previously saw (the LIST query never filtered before). No backfill migration; owners re-share by setting visibility to `shared`. Comms for analysts: *"Your previously-shared segments are now visible only to you — re-share them via the visibility icon. Nothing was deleted."*

- **Activity event spine.** New `029-activity-events.sql` adds the append-only `activity_events` table keyed on actor `sub` (Keycloak subject, always present), event-type enum (`query_run`, `segment_op`, `feature_open`, `export`, `workspace_switch`), indexed on `(actor_sub, ts)` and `(event_type, ts)`. `recordActivity` is fire-and-forget, never throws (WARN on disk error, continues). Server-only events (`query_run`, `segment_op`) are unspoofable; client beacon `POST /api/activity` accepts only `feature_open`/`export`/`workspace_switch` (actor sub resolved server-side).

- **Chat-stats bridge.** chat-service `GET /internal/stats` (bulk by `sub[]`) behind a **mandatory** `INTERNAL_SECRET` gate — never fails open (missing/mismatched secret → 403). Server client `chat-stats-client.ts` is timeout-safe and degrades to null counts when chat-service is unreachable (admin pages never 500/hang).

- **Admin aggregation.** `GET /api/admin/activity/summary` (org rollup: status counts, active 7/30d, inactive list [>30d no-login], top features, total chat turns) and `GET /api/admin/activity/users/:email` (per-user: last login, segment count, recent features + query shapes, chat stats, last access-management change). `activity-aggregator.ts` resolves email→sub via `user_access.kc_sub` before the chat fan-out. **Identity model:** artifacts/telemetry key on `sub`; access grants + admin UI key on lowercased email; canonical map is `user_access.kc_sub` (NOT `users.email`, which is nullable/post-login).

- **Sys-admin hub** at `/admin` — tabbed shell (Users & Access · Observability · Dev/Chat-Audit) on a reusable `TabShell` generalized from the DevAudit tablist. Per-user control panel: role/status + workspace/game/feature grants (bulk select-all/clear, optimistic rollback on save error), workspace switch-ability, game N-of-M, feature override badges, read-only activity snapshot, "last changed by/at". Observability tab: org KPIs, inactive-user quick-disable triage, top features, and an audit-log viewer (filter by actor/action/target/date; CSV export emits a self-audit `export` event). Cross-user chat audit: admin-gated `GET /api/admin/chat/sessions|:id|turns` resolves the target email→kcSub and proxies chat-service with the target user's sub.

- **Retention & privacy.** `prune-activity-events.ts` daily hard-deletes events older than 90 days (`ACTIVITY_RETENTION_DAYS` constant; not env-configurable yet). Query-shape telemetry stores member NAMES only — no filter values, no UIDs. New env var `INTERNAL_SECRET` (main server passes it; chat-service validates). See `deployment-guide.md`.

## 2026-06-03 — Unified Concept Fabric (trust/visibility ladder, registry, reverse index, linking, authoring)

Shipped a cohesive concept system spanning glossary terms, business metrics, and segments with unified trust/visibility governance, bidirectional references, and concept-aware authoring flows. Plan: `plans/260603-0324-unified-concept-fabric/` (phases 0–5). Tests: 8 new server tests (concept-authoring-governance, concept-reverse-index, glossary-unified-refs, trust-mapping); 4 FE tests (concept-chip, concept-hover-card, resolve-concept, cross-layer-relations).

- **Unified trust/visibility ladder.** New categorical trust ∈ {draft, certified, deprecated} and visibility ∈ {personal, shared, org} applied uniformly across glossary terms, metrics, and segments. Server-side mapping service (`trust-mapping.ts`) derives these on read from legacy `status` and `trustTier`; metrics gained a new optional `visibility` YAML key; segments got a nullable `visibility` column (migrations 027–028, NULL→personal on read). Glossary write-side remains derived (not persisted) — a read-side-first abstraction enabling future persistence without schema churn.

- **Typed namespaced refs + dangling-guard.** Glossary `secondaryCatalogIds` now validated against a namespace allowlist (`business_metrics|data_model|segments`) and format (no `..`, proper segment IDs). Write-time enforcement in `glossary-validators.ts`; delete-time integrity check (`concept-ref-integrity.ts`) returns 409 if any glossary term or metric references a segment/metric being deleted.

- **Concept reverse-index service** (`concept-reverse-index.ts`): derives three edge types per (workspace, game): field→metrics (which metrics use this cube field), metric→fields (which fields compose this metric), and field/term→segments (which segments filter on this dimension/term). Cached at the service layer, invalidated on glossary/metric/segment writes. New `GET /api/concepts/:namespace/:id/relations` endpoint returns typed edges (source type + target type + verb).

- **Concept resolution + shared affordances (FE).** Model-driven `resolveConcept` (combines `resolveConceptHref` for type dispatch + `conceptTypedActions` for verb routing + `toConceptRef` for serialization). Shared `ConceptChip` component renders glyphs (▦ metric, ⓘ term, ＃ field, ◑ segment) with trust badges (draft/certified/deprecated). `ConceptHoverCard` hover-gates the relations fetch and renders navigable trust-badged edges; used across Chat assistant message flow, Catalog glossary rows, and Segments row actions. Components live in `src/components/concept-chip/` and integrate via `src/api/concepts-client.ts`.

- **Authoring & governance.** `/api/glossary` and `/api/concepts` added to write-RBAC `PROTECTED_PREFIXES` (viewers blocked). `requireRole('admin')` on certify/trust-PATCH endpoints. New `POST /api/concepts/promote` (editor+) promotes a segment → draft glossary term and/or draft metric stub, atomically IDOR-safe (read source scoped by workspace). FE segment row menu + Catalog detail affordances surface "Promote to glossary term" action.

- **Cross-layer explorer.** Schema Cartographer (`/catalog/data-model`) detail panel now shows reverse edges as navigable trust-badged chips grouped by verb (used_by_metrics, composed_by_terms, filtered_by_segments). New `?focus=` query parameter generalized to namespaced refs (e.g., `?focus=metric:revenue`, bare `cube.member` back-compat preserved). Layer filter pills (all / metrics / terms / fields / segments) added to the detail panel.

## 2026-05-31 — Connector management + cross-source/cross-game modeling (phases A–C)

Editable connectors (move from `.env` to DB) + executable cross-game joins + declared cross-source links. Plan: `plans/260531-1016-connector-management-cross-source-modeling/`. Tests: 46 new server tests, all passing.

- **Phase A — Connector CRUD + bootstrap-seed.** `/api/onboarding/connectors` now support PATCH (edit connector fields) and new POST /disable (soft-disable). Secrets remain write-only (blank edit keeps existing sealed credential; never returned). On boot, if `CONNECTOR_SECRET_KEY` is set, the env-seeded Trino connection (`TRINO_PROFILER_*`) materializes into an editable DB row; without the vault key, degrades to read-only env seed. Read-only worked-example connector (`existing-model`) refuses edit/disable. New audit trail via `connector-store.ts` append-only write path.
- **Phase B — Cross-game executable join (same dataSource).** Users model joins between cubes in different games (e.g., ballistar ↔ cfm) sharing the same Trino connector. New POST `/api/onboarding/cross-game-join` with dual-game grant intersection enforced (403 if user lacks either game). Scaffolder emits fully-qualified FQ-addressed join. Cross-dataSource (different connectors) refused at 409.
- **Phase C — Cross-source declare + flag (advisory).** Users declare relationships between cubes on different connectors/dataSources. New migration `025-cross-source-links.sql` + API (`GET/POST/DELETE /api/onboarding/cross-source-links`). These links are non-executable (never compiled to YAML) — marked advisory only to flag rollupJoin-eligible or ETL pathways. Engine constraint: Cube cannot execute SQL joins across different dataSources; only within one (same dataSource + same connector = executable; cross-dataSource = advisory declaration).

## 2026-05-30 — Multi-source connect + guided model builder (onboarding v2)

`/data` graduates from a Trino-only request/preview surface into the product layer for the whole data-model lifecycle: connect any supported source (real, secret-vault-backed) → build its semantic model step-by-step (YAML = compiled output) → co-locate sources at the model layer. Plan: `plans/260530-1406-cube-model-onboarding-agent/` (v2, phases 9–16). Tests: server 500/500 pass.

- **Nav cleanup.** Drift Center + Access moved into Settings tabs (Access admin-only); Data moved to the sidebar footer above Glossary; dropped from the nav-visibility registry.
- **Connector secret vault.** `connector-secret-vault.ts` (AES-256-GCM, key from `CONNECTOR_SECRET_KEY`, fail-closed) + `connector-store.ts` (CRUD + append-only audit, secrets sealed at rest) + migration `024-connectors.sql`. `trino-profiler-config.ts` generalized with `sourceType`; DB connectors merge into the public list/resolver (DB wins), env/file kept as bootstrap. Public projection never returns secrets.
- **Source-type registry + dataSource abstraction.** `source-type-registry.ts` (per-type field schema + driver + capability flags: Trino/Postgres/MySQL/Redshift/ClickHouse/Snowflake/BigQuery). `datasource-registry-writer.ts` writes a secret-free `datasources.config.json` — the config-not-code contract that resolves the "Cube dataSource is cube.js code" gap (cube.js reads the registry; one-time generalization, then adding a source = a config entry).
- **Multi-source profiler.** `profiler-interface.ts` `getProfiler(connector)` dispatch (NOT_INTROSPECTABLE / DRIVER_NOT_WIRED → honest 501); `information-schema-profiler.ts` (ANSI, injectable `SqlRunner`, driver-pluggable via `registerSqlRunnerFactory`). Trino stays the reference impl; `onboarding.ts` introspect/generate dispatch via the interface.
- **Connect & Profile form → real provisioning.** Replaced the disabled stub. `GET /source-types`, `POST /connectors/test` (validate → SSRF guard → bounded probe), `POST /connectors` (validate → vault-encrypt → persist → registry entry → 201). `connector-host-guard.ts` (SSRF: blocks loopback + cloud-metadata, allows RFC1918/internal). FE `connector-connect-form.tsx` renders dynamic per-type fields; secrets never echoed.
- **Worked example (read-only).** `existing-model-reader.ts` + `GET /example-model` read committed `cube-dev` cube YAMLs; new **Model** tab in connector detail renders the existing cubes/dimensions/measures/joins as the baseline a new source's model converges toward.
- **Guided model builder.** New triage view D (`view-builder.tsx`): Cube → Dimensions → Measures → Joins → Preview stepper over the shared `use-onboarding-draft` engine; auto-mapped fields shown ✓, ambiguous ones get include/skip; YAML compiled only at the Preview step (validate + stage). Default view for non-viewer roles; Queue/Graph/Chat retained.
- **Cross-source model layer.** `data_source` added to the cube schema + stamped by the scaffolder (non-default sources) so multiple connectors co-exist in one model. `join-source-classifier.ts` classifies same vs cross-source joins (cross → rollupJoin advisory, declared not executed — honest about Cube's engine limit). Cross-connector join-picker UI deferred to v2.5.
- **Security posture.** New attack surface (user-supplied host, secret-at-rest) → SSRF guard + AES-GCM vault + RBAC; flagged for the post-ship `/ck:security` review before prod enablement.

## 2026-05-30 — Cube-model onboarding agent (bootstrap stage)

Data-analyst-facing introspection + inference + scaffolding pipeline to stage draft Cube models from raw warehouse schema. Feeds the existing drift-center and coverage surfaces. Plan: `plans/260530-1406-cube-model-onboarding-agent/`. Tests: server 442/442 all pass.

- **Trino profiler.** Direct read-only warehouse access: `trino-profiler.ts` + `trino-rest-client.ts` (fetch-based, zero npm deps, SSRF-safe) + `trino-profiler-config.ts` connector config. Gated behind `TRINO_PROFILER_*` env creds; creds redacted in all logs/responses.
- **Raw schema inference.** `raw-schema-inference.ts` (pure) — column profiles → Cube skeleton (dimensions/measures/time-dim/PK/joins) with confidence flags + warm/cold mode priors. DATE columns auto-cast to TIMESTAMP.
- **Cube scaffolder.** `cube-model-scaffolder.ts` — inferred schema → Zod-validated Cube model + block-style YAML via `types/cube-model.ts`.
- **Staging store.** `onboarding-draft-store.ts` + migration 023 — draft lifecycle (pending → accepted → rejected → written). Upsert preserves accepted/written states. Append-only audit trail.
- **Onboarding API.** `routes/onboarding.ts` — GET connectors/introspect, POST generate, drafts CRUD, accept/reject, validate, approve (writes YAML via `cube-model-writer.ts` — atomic + .bak rollback + /meta poll). RBAC via `enforce-write-roles` + game-grant re-checks + self-approve guard (generator ≠ approver in prod).
- **LLM enrichment + golden seeding.** `cube-model-enrichment.ts` (enriches member names via LiteLLM; drops hallucinations), `golden-query-seeder.ts` (mines dashboard_tiles + chat DB for co-occurrence). Both flag-gated off by default (`onboarding.llmEnrichment`, `onboarding.goldenSeeding`).
- **Frontend data hub.** New `/data` nav entry + `src/pages/Data/` — connectors → connector detail (tabs: Datasets/Agents/Coverage/Drift/History, Coverage/Drift deep-link out) → dataset tables + warm/cold mode → triage canvas (3 interchangeable views: queue+YAML / entity-graph / conversational, single `use-onboarding-draft` engine). Per-user triage-view pref via `onboarding.triageView`. Routes: `src/api/onboarding-client.ts`.

## 2026-05-30 — DB-authoritative authz + Microsoft SSO + admin access page

Demoted Keycloak to authentication-only (brokers Microsoft/Entra OIDC in prod) and moved authorization into the app DB with default-deny. Plan: `plans/260530-0219-db-authz-microsoft-sso-admin-page/`. Tests: server 351 (all pass).

- **DB-authoritative authz.** New tables (`migration 019`): `user_access` (role + `pending|active|disabled` + `kc_sub`, keyed by lowercased email), `user_workspace_access`, `user_game_access`, `feature_flags`. `access-store.ts` resolves all grants for an email behind a short TTL cache; mutators invalidate on write and guard the last active admin. Role + grants are resolved **per request** from the DB (`authenticate.ts`), not from the client JWT — revocation takes effect within `ACCESS_CACHE_TTL_MS`.
- **Default-deny login.** `/api/auth/keycloak/callback` mints a privileged JWT only for `status='active'` emails; unknown/pending/disabled → `403 ACCESS_PENDING` + an auto-created pending row for the admin queue + KC `sub` reconciled. JWT now carries identity only (`allowedGames` claim dropped). FE shows a "request access" screen.
- **Server-side game enforcement.** `workspace-header.ts` 403s `GAME_FORBIDDEN` when a requested game isn't in the user's grants and mints the Cube token with `userId=email` so cube-dev's `checkAuth` re-enforces it (closes the FE-only gap). Workspace gate moved from per-role-config to per-user grants (role fallback via `AUTHZ_GRANT_FALLBACK` during migration). Feature gate (`require-feature.ts`) is real server enforcement, not cosmetic.
- **Admin access API + UI.** `/api/admin/*` (router-scoped `requireRole('admin')` + `requireFeature('admin')`, audited via `access_audit`, migration 020) lists users and toggles role/status/workspace/game/feature grants + pre-provision by email. New admin-only page `/admin/access` (master-detail, design-token compliant).
- **cube-dev shared authz source.** `cube/auth-db.js` now queries the playground's `GET /internal/access/:key` (shared secret, TTL cache, fail-closed) instead of the static JSON, with file fallback for local dev.
- **Cutover safety.** `AUTH_BOOTSTRAP_ADMINS` env seeds active admins on boot. See `docs/deployment-guide.md` for env + rollout. **Deferred (devops):** KC Microsoft IdP realm config, prod redirect URIs, staging rollout dry-run, flip `AUTHZ_GRANT_FALLBACK` off after seeding.

## 2026-05-27 — glossary resolver consolidation

Unified metric resolution from catalog terms into a single load-normalized resolver layer. Plan: `plans/260527-1306-glossary-resolver-consolidation/`.

- **Unified metric resolver.** Server derives `measureRef`/`ratioRef`/`refKind` at glossary-read time (`GET /api/glossary`); chat-service has one `resolveMetric` contract replacing base `pickMetric` + three flag-gated `applyGlossaryV2` short-circuits. Resolver output: `{ref, ratioRef, refKind, confidence, gap, alternatives, matchedOn}`.
- **Vocabulary alignment.** Glossary loads cube members (not catalog paths); the /meta gate is now a true safety net (validates members + ratio pairs, names missing member). Ratio terms auto-run two-measure queries; expression/unknown clarify with reason.
- **Legacy flag replaced.** `CHAT_GLOSSARY_V2` removed; replaced by kill-switch `CHAT_GLOSSARY_LEGACY` (default false) for rollback. Slated for removal next release.
- **Deferred follow-ups:** (1) Delete `CHAT_GLOSSARY_LEGACY` kill-switch + `applyLegacyRefContract` path next release. (2) Ratio-metric session continuity gap: a clarified ratio term is not persisted to `slots.ratio` (cross-turn reuse broken; single-turn auto-route OK).

## 2026-05-27 — metric ↔ cube coverage monitor + drift fixes

Reconciled the business-metrics registry against the live cube-dev model and shipped a monitoring/scaffolding surface. Plan: `plans/260527-1257-metric-cube-coverage-sync/`. Tests: server 295, web 1441 (all pass).

- **WAU/trailing measures built.** Added `wau`/`trailing_wau`/`trailing_mau` to `active_daily` and `trailing_wpu`/`trailing_mpu` to `user_recharge_daily` in cube-dev (per game: ballistar, cfm, jus, pubg), then repointed the 5 registry metrics off `mf_users`. Active-retention metrics `rr`/`rr01`/`rr07`/`rr30` repointed to the existing `retention` cube (`retained_dN ÷ cohort_size`).
- **Anomaly-detector hardening.** `scanGameLegacy` now runs `validateRefs` against per-game `/meta` and skips unresolved metrics with one consolidated warning instead of N×400 stack traces per tick.
- **Coverage service + API.** `metric-coverage-resolver.ts` computes three gap types per game (broken refs, uncovered cube measures, metric×game matrix) from `/meta`, fail-open. `GET /api/business-metrics/coverage` (all games or `?game=`). `POST /api/business-metrics/scaffold` generates `trust: draft` metric stubs (via `metric-stub-scaffolder.ts`) for uncovered measures through the existing atomic writer; idempotent (skips refs already covered).
- **Settings → Metric coverage tab.** New panel: broken-refs-by-game, uncovered-measures with multiselect + "Scaffold drafts", and an availability matrix. Refresh = explicit sync gesture.
- **Dev log capture.** `npm run dev:all` now tees output to `logs/dev-all.log` (rolling 3h) for daily triage.

## 2026-05-26 — chat disambiguator memory layers + Settings UI

Four-part ship consolidating session memory + cross-session user preferences + Settings UI panel. Plan: `plans/260526-xxxx-chat-disambig-memory-and-settings/` (internal working document).

- **Session memory expansion (1b5b994).** `SlotMemory<T>` wrapper pairs each resolved value (metric, dimension, timeRange, filter) with the user's original phrasing. Write trigger flips from "only on auto-route" to "every slot above confidence floor" so ambiguous turns that prompt for clarification still capture confirmed values. Phrase storage enables relative date re-resolution: "this week" now re-anchors to the current week boundary when the next session opens, not frozen to the first session's calendar.
- **Cross-session user_disambig_prefs layer (89a92f0).** New durable table `user_disambig_prefs` (owner_id, game_id, slot, value_json, hit_count, last_used_at, created_at, indexed by owner+last_used). CRUD adapter + layer-3 cascading reads (L1 session → L2 turn-memo → L3 user-prefs). Every confident slot lands in both L1 and L3 at write time so preferences accumulate across sessions. New phrase-resolver date rules: "this month" / "tháng này" / "this week" / "tuần này" with re-resolution at read time.
- **Settings UI + API (ab434d1).** `Settings → Chat` tab surfaces a second card ("Remembered defaults") listing every user-learned preference from L3, with per-row clear and clear-all button. Three new HTTP routes: `GET /api/chat/user-prefs`, `DELETE /api/chat/user-prefs/:slot`, `DELETE /api/chat/user-prefs` (all owner-scoped). Server resolves cube member refs to readable labels via warm cube-meta cache, surfaces user's original phrase for timeRange (not computed dates).
- **UX fix (e4e7dfd).** Disambig chips (pending slot resolution) now suppress follow-up chip suggestions on the same turn so users see one clear "what next" affordance.

## 2026-05-25 (later) — chat-audit redesign + cache effectiveness dashboard

Six-phase IA + UX overhaul of `/dev/chat-audit` applying the `huashu-design` methodology. Plan: `plans/260525-1709-chat-audit-redesign-and-cache-dashboard/`. Hi-fi mockup at `plans/.../design/hifi-mockup.html` was the design contract. Tests: chat-service 478 (+51 new), FE 1265 (+~85 new); 2 pre-existing baseline failures unchanged.

- **Top-tab IA.** `/dev/chat-audit` is now a 4-tab shell (Sessions · Search · Leaderboard · Cache) with URL-driven tab state, ARIA tabs pattern, sticky header, and legacy `/dev/chat-audit/:sessionId?` → `/dev/chat-audit/sessions/:sessionId?` redirect that preserves `#turn-...` hash anchors.
- **Unified search with mode toggle.** One search input + `[Turns] [Sessions] [Cached queries]` chip group. URL state `?q=&mode=`. Three result renderers per mode. New BE route `GET /debug/search/cached` (owner-isolated via `original_turn_id → chat_turns → chat_sessions` JOIN — prevents leaking other owners' cached queries even though the cache itself is per-game-shared).
- **Leaderboard reskin + sparkline.** `dailyCounts: number[]` added to `GET /debug/leaderboard/skills` response; today-anchored buckets. New inline pure-SVG `<SkillTrendSparkline>` column. Single-data-point edge case renders a `<circle>` (not invisible polyline).
- **Cache-effectiveness data layer.** Additive migration: `response_cache.cube_meta_hash TEXT`. New `cache-effectiveness-store.ts` + `cache-effectiveness-queries.ts` (5 owner-scoped SQL helpers). New route `GET /debug/cache-effectiveness?game=&days=&topN=` returning `{ summary{hitRate, dollarsSaved, tokensSaved, latencyWinMs}, sparkline, topQueries, staleRatio, legacyRatio }`. $ saved formula = `Σ cost_usd × (hit_count − 1)`. Cross-game = weighted overall, scalar fractions in [0,1].
- **Cache-effectiveness dashboard UI.** 4 hero stat cards (hit rate / $ saved / tokens saved / latency win), hits-vs-misses pure-SVG sparkline, top-N cached queries sortable table, stale-cache pressure banner at >25% (env-tunable via `VITE_STALE_CACHE_BANNER_THRESHOLD`). Gradient accent allowed only on the $ saved hero (anti-AI-slop rule from huashu-design).
- **Polish.** Shared `<EmptyState>` + `<SkelRow>` / `<SkelCard>` / `<SkelText>` primitives. Cmd-K opens unified search (route-scoped, bails when focus is in unrelated INPUT/TEXTAREA). Cross-tab navigation: leaderboard skill name → Sessions tab with `?skill=` filter. Mockup-faithful styling throughout.
- **Server proxy fix (earlier commit `85291bb`).** Phase 04 of chat-audit v2 added `POST/DELETE /debug/turns/:turnId/annotation` and `GET /debug/search` to chat-service but the server proxy never forwarded them — star/flag/note saves and cross-turn search both hit 404. Three missing routes added.
- **Deferred from code review:** N2 (cross-game `currentMetaHash` arbitrary pick), N4 (deleted sessions still counted in cache aggregates). Both lower-priority polish, filed as follow-ups.

## 2026-05-25 — liveops Phase 1: live KPI hero strip + auto-refresh + game scoping

- **New `/liveops` route** with a 5-tile KPI hero strip showing DAU, MAU, Revenue (VND), Paying users, and ARPDAU for the active game. Plan: `plans/260525-1540-liveops-feature-pack/phase-01-live-kpi-hero-strip.md`.
- **KPI strip features:** sparklines (14d history) + delta % vs prior period + `LiveBadge` last-refresh indicator + auto-refresh every 45s (pauses when tab hidden) + error boundary per tile (one tile failing doesn't blank others). Derived KPI (ARPDAU = revenue / DAU) computed client-side.
- **Game scoping:** respects active game via `GameContext`; cache key includes gameId; refetch on game switch; gap-handling for games missing `active_daily` or `user_recharge_daily` cubes (muaw, ptg).
- **Implementation:** 10 new files (kpi-config, kpi-hero-strip, use-live-kpis hook, formatters, cache, fetch orchestration, meta probe, game-dim predicate) + 4 modified (App route, sidebar, bootstrap hook). 32/32 tests pass; 4 code-review findings (token race-guard, cache clarity, NaN handling, meta dedup) caught and fixed.

## 2026-05-25 — chat-audit v2: soft-delete + monitoring + response cache + settings tab

Seven-phase upgrade to chat-service observability and runtime. Plan: `plans/260525-1410-chat-audit-v2-monitoring-cache/`. Tests: chat-service 427 (+~85 new); root 962 (no regressions).

- **Soft-delete + 7d retention.** `DELETE /sessions/:id` now soft-deletes (sets `chat_sessions.deleted_at`), does NOT cascade. New `POST /sessions/:id/restore` clears the flag. Retention sweep (`chat-service/src/services/retention-sweep.ts`) hard-purges + tombstones rows older than 7d on a 1h cron. Chat UI hides deleted; `/dev/chat-audit` shows them with a Restore button. `POST /agent/turn` now 404s on deleted sessions (no silent resurrection).
- **stop_reason + permission_decisions.** New `chat_turns.stop_reason` column + new `permission_decisions` table, both captured from the SDK `result` message via a new `onTurnFinalized` observer hook. Surfaced in chat-audit as a colored stop-reason pill + a dedicated decisions section.
- **Cache % + I/O ratio on turn header.** New `cache_creation_tokens` + `cache_read_tokens` columns on `chat_turns`. `/dev/chat-audit` turn-header strip shows `cache 73% · io 0.42` alongside the existing `in/out/$/ms/model` group.
- **Annotations + cross-turn search.** New `turn_annotations` table (star/flag/note) + routes `POST/DELETE /debug/turns/:turnId/annotation`. Cross-turn LIKE search via `GET /debug/search?q=&owner=&game=&starred=` over user/assistant text + tool args.
- **Skill leaderboard.** `GET /debug/leaderboard/skills?game=&days=` returns per-skill `{ count, p50/p95 latency, avg/total cost, success rate }` (Node-side percentile). New page `/dev/chat-audit/leaderboard` with sortable table.
- **Response cache (exact-match v1).** New `response_cache` table (per-game scope, shared across owners — known PII trade-off). Key = sha256 over normalized `(skill, gameId, userText, cubeMetaHash, model, systemPromptHash)`. Cube-meta hash derived lazily from sorted dim/measure/segment names. Cache hits replay through SSE byte-identically (loading + token chunks + result event). 24h TTL via existing sweep. Off by default behind `RESPONSE_CACHE_ENABLED=true`. New `CacheHitBadge` in chat-audit links back to the original turn.
- **Chat Service settings tab.** `/settings → Chat Service` exposes: default model (allowlisted via `config.allowedModels`, sent as `X-Model` header), bypass cache (`X-Bypass-Cache: 1`), clear cache for current game (`DELETE /api/chat/debug/cache?game=<id>`), show debug links on chat page, raw SDK events default-expanded. Settings persist in localStorage; bypass-cache is symmetric (skips both read and write).
- **Semantic cache deferred.** Internal LiteLLM proxy doesn't expose embedding models; revisit if exact-match hit-rate <10% in production.

## 2026-05-23 (later)

### Fixed — server-side game scoping (PTG no longer loads ballistar yaml)

- **Root cause.** `cube-dev/cube/cube.js` is multi-tenant via JWT `{ game }` claim, but `gameFor()` falls back to a hard-coded literal `'ballistar'` when the claim is missing. The playground sent the same static token (no `game` claim) for every UI game switch, so every game silently loaded ballistar's yaml.

- **Server endpoint.** New `GET /api/playground/cube-token?game=<id>` mints a Cube-compatible HS256 JWT in-process using `CUBEJS_API_SECRET` (shared with Cube). Pre-minted `CUBE_TOKEN_<GAME>` env vars override. Returns `{ token, source: 'env' | 'minted' | 'fallback' | 'none' }`. No new npm dep — `node:crypto` does the signing.
- Files: `server/src/services/{sign-cube-token.ts, resolve-cube-token.ts, games-config-loader.ts}`, `server/src/routes/cube-token.ts`.

- **Frontend bootstrap.** New `useCubeTokenBootstrap()` hook (mounted from `App.tsx`) listens to `GameContext.gameId` and, on every change, calls the new endpoint and pushes the returned token into `SecurityContextContext.saveToken`. The existing `useCubejsApi` memo rebuilds, so the next `/meta` / `/load` carries the right `game` claim. `null` responses (no token strategy configured) leave the current token alone so manually-pasted JWTs survive.
- Files: `src/api/cube-token-client.ts`, `src/hooks/use-cube-token-bootstrap.ts`.

- **Cube game-id aliases.** `cube-dev/cube/cube.js` now carries a `GAME_ALIASES` map (`cfm_vn → cfm`, `jus_vn → jus`, `ballistar_vn → ballistar`) and a `canonicalGame()` helper applied in `checkAuth` and `gameFor`, so the frontend ids in `gds.config.json` align with Cube's canonical schema keys without a data migration.

- **Setup.** `CUBEJS_API_SECRET` must be on the playground server's env (same value Cube uses). Without it, `/api/playground/cube-token` returns `source: 'none'` and the UI continues to use the existing single token.

- Tests: 4 new server tests (`sign-cube-token`, `cube-token-route`, extended `resolve-cube-token`); 1 new frontend test (`cube-token-client`). 128/128 server + 688/688 frontend green.

## 2026-05-23

### Changed — main-flow redesign, metric split, end-to-end game picker

- **Header / main flow**
  - Removed the redundant header search box (`SearchBox`). ⌘K opens the real `SmartSearchOverlay` registered via `SmartSearchProvider` in `App.tsx` — no functional change for users.
  - `IndexPage` now always pushes `/build` in fallback mode (production-style Cube backend where `/playground/files` 404s). Dev-mode connection wizard branch retained.

- **Metric routes split** — the existing full-page wizard at `/metrics/new?v=2` actually edited cube YAML (artifactKind: measure / dimension / segment) so it is now correctly labelled and routed as the data-model builder.
  - New canonical route: `/data-model/new?v=2` (renders `NewMetricPage`). Header pill relabelled "New Data Model".
  - Legacy `/metrics/new` + `/metrics/new/success` 301 to the new paths so any external deep links keep working.
  - The Catalog metrics-tab `+ New metric` CTA now targets `/catalog/metric/new` (already-built `MetricCompositionWizard`) — a lean 4-step form that POSTs to `/api/business-metrics`.
  - `+ New data model` link added on the Catalog data-model tab.
  - i18n: `nav.newMetric` → `nav.newDataModel`; legacy `user.settings.legacyNewMetric` removed.

- **v1 NewMetric entry points unmounted** — files kept with `@deprecated` headers for one release cycle.
  - Removed `<LegacyNewMetricDialogMount />` from `QueryStatePillBar`.
  - Removed the "Legacy New Metric" item from the user-menu dropdown.

- **End-to-end game picker**
  - New `src/shared/game-scoping/apply-game-filter.ts`: merges `{ <cube>.gameId equals activeGameId }` into a Cube `Query` for every referenced cube that exposes a `gameId` dim. Idempotent. 7 unit tests.
  - `QueryTabsRenderer` (Playground): injects the filter on `defaultQuery` and remounts `<QueryTabs>` via `key={gameId}` on game switch, so result state clears.
  - Catalog (`use-catalog-meta`) and Segments (`library-view`, `editor-view`) were already game-aware; verified.
  - **Known limitation**: game filter is client-side only. Backend scoping (Cube JWT / security context) is the next step.

## 2026-05-19 (later)

### Added — Segments workspace P2–P8 (FE shell, identity-map, presets, editor, cron, round-trip, drift)

- **P2 — FE shell + push modal + library + sample users**
  - `/segments` route (Library list / Detail / `/segments/new` / `/segments/:id/edit` / `/segments/identity-map`).
  - `Segments` NavPill in `Header.tsx` (desktop + mobile menu); i18n strings in `en.json` / `vi.json`.
  - `SegmentsSaveBar` in `QueryBuilderResults` footer: when the executed query contains a mapped identity dim, surface "Save N user_ids as segment" → opens `PushModal` (create new / append to existing).
  - Library: KPI tiles (live / static / total uids / in-use), search + type filter + sort, segment row with `LiveBadge` / status pill / owner. Pure helper `filterAndSortSegments` covered by 7 unit tests.
  - Detail shell: breadcrumb + headline KPI strip + tab strip (Overview / Engagement / Monetization / Retention / Sample users / Saved analyses / Predicate). `SampleUsersTab` does deterministic seeded reshuffle + page + Export-all CSV.
  - Shared FE plumbing: `src/api/api-client.ts` (X-Owner header + typed errors), `src/api/segments-client.ts`, `src/hooks/use-identity-map.ts`, `src/hooks/use-segment-selection.ts`, `src/types/segment-api.ts`.

- **P3 — Settings identity mapping + auto-suggest + Import IDs**
  - `server/services/identity-suggester.ts` — auto-suggests `*.user_id / .uid / .customer_id / .player_id / .account_id` from `/meta`; confidence ranked.
  - Extended `routes/identity-map.ts` GET to merge persisted overrides with auto-suggestions (`source: 'manual' | 'auto-suggest'`, `is_suggested`). DELETE reverts to auto-suggest.
  - `server/services/csv-importer.ts` — streamed parse, BOM strip, CRLF normalise, dedupe, hard `MAX_ROWS=5000` cap, rejects non-printable + null-bytes.
  - `POST /api/segments/import-ids` — JSON body `{ name, cube, csv, tags? }` → static segment. Identity-dim mapping is enforced (400 with `IDENTITY_DIM_MISSING` code if absent).
  - FE: `/segments/identity-map` route (list every cube, set/reset identity field); `ImportIdsModal` wired to Library `Import IDs` button with client-side file preview.
  - 14 new server tests (`identity-suggester.test.ts`, `csv-importer.test.ts`).

- **P4 — Preset infrastructure + `mf_users-hub` preset tabs**
  - Schema-agnostic preset format under `src/pages/Segments/presets/`: `types.ts`, `registry.ts`, `mf-users-hub.ts`. Each preset declares `hubCube`, `identityDim`, `headlineKpis: KpiSpec[]`, `tabs: TabDef[]` with `kind: 'line' | 'bar' | 'donut' | 'composition'`.
  - Card primitives in `src/pages/Segments/detail/cards/`: `kpi-card.tsx`, `line-chart-card.tsx`, `bar-list-card.tsx`, `donut-card.tsx`, `composition-card-component.tsx`, plus a shared `card-shell.tsx` and `format-value.ts`. All chart cards reuse the P0 visual primitives.
  - `use-segment-cube-query.ts` injects `{ member: identityDim, operator: 'equals', values: uids }` into the request, caches results for 10 min, throttles to 3 concurrent calls. Empty-state when no cubejsApi token.
  - `usePreset(segment)` resolves `preset_id` (or falls back to `hubCube` match). Headline KPI strip + 4 analytics tabs in `detail-view.tsx` now render from the preset when available.

- **P5 — Visual predicate editor + live preview + SQL preview**
  - Backend: `services/preview-service.ts` translates a predicate tree to a Cube query (`{ measures: ['<cube>.count'], filters, limit: 1 }`), fires `/load` + `/sql` in parallel via `Promise.allSettled`, returns `{ estimated_count, cube_query, sql_preview, took_ms, cached }`. Cache TTL 60s keyed by `sha256(tree + cube)`. New route `POST /api/preview`.
  - FE: `src/pages/Segments/editor/` — `editor-view.tsx`, `identity-card.tsx`, `refresh-behaviour-card.tsx`, `predicate-builder/{predicate-group, predicate-leaf, value-input, operators}.tsx`, `right-rail/{resolved-cohort-card, sql-preview-card}.tsx`, hooks `use-predicate-state.ts` (immutable tree ops + `isTreeValid`) and `use-preview.ts` (500 ms debounce + AbortController + 14-entry ring buffer for sparkline).
  - `Edit predicate` button in detail header now routes to `/segments/:id/edit`. `New segment` button in Library toolbar routes to `/segments/new`. 11 new state-hook tests + 3 preview-service tests.

- **P6 — Cron worker + live mode + FE polling + status transitions**
  - `server/services/segment-status.ts` — single helper for atomic `(status, broken_reason, updated_at)` writes plus `setSegmentUids` that also flips status to `fresh` and clears `broken_reason`.
  - `server/jobs/refresh-segment.ts` — drift-aware refresh: looks up identity field, calls `cube-client.load` with a per-segment 60 s timeout, dedupes uids by identity column, writes via `setSegmentUids`. Cube failures or missing identity mapping → `broken` with a descriptive reason.
  - `server/jobs/refresh-queue.ts` — FIFO single-drain queue (`processing` flag prevents overlapping ticks).
  - `server/jobs/cron-runner.ts` — `setInterval` every 60 s (immediate first tick); `listDueSegments` selects predicate segments whose `last_refreshed_at` aged past `refresh_cadence_min * 60_000`; gated on `NODE_ENV !== 'test'` at boot.
  - `POST /api/segments/:id/refresh` now enqueues + returns 202 with `{ status: 'refreshing' }`; rejects manual refresh on static segments with `NOT_LIVE`.
  - FE: `use-segment-live-polling.ts` (30 s, pauses while `document.hidden`); shared `StatusPill` component (fresh / refreshing / stale / broken w/ tooltip); `RefreshNowButton` (optimistic spin → next poll reveals end state); `BrokenSegmentBanner` with "Edit predicate to fix" CTA.
  - Library row renders the status pill next to the type badge; Detail header renders it next to the cube badge + LiveBadge.

- **P7 — Saved analyses tab + Copy as filter**
  - `src/utils/playground-deeplink.ts` — builds `#/build?query=…` URL. Falls back to `sessionStorage('gds-cube:pending-deeplink:<id>')` + `?from-segment=<id>` when encoded query > 8 000 chars. 5 unit tests.
  - `SavedAnalysesTab` lists per-segment analyses from the existing `/api/segments/:id/analyses` route, with `Open in Playground` (deeplink + uid filter applied on top of the saved query) and per-card delete via Popconfirm.
  - `Copy as filter` button in Detail header opens Playground with the segment's uid IN-filter pre-applied (uses `defaultBaseQuery(segment.cube)` when no base query is in flight).

- **P8 — Drift detection, schema, docs**
  - New migration `002-drift-tracking.sql` adds `segments.predicate_meta_version` + `segment_analyses.query_meta_version` columns.
  - `server/services/drift-resolver.ts` compares the segment's stored meta-version against the live `/meta` hash; re-translates the predicate tree against current `/meta` if drift detected; surfaces missing members so the cron path can mark the segment `broken` with `Schema drift — missing members: …`.
  - `refresh-segment.ts` now calls `resolveDrift` before `/load`; on successful rehydrate it persists the new `cube_query_json` + `predicate_meta_version` atomically before the load runs.
  - 3 drift-resolver tests cover no-drift / rehydrate / broken-member paths.

### Totals
- **Server tests:** 23 → 50 (added: identity-suggester ×4, csv-importer ×11, preview-service ×3, refresh-segment ×3, drift-resolver ×3, mergeIdentityRows ×3).
- **FE tests:** 32 → ~70 (added: library-filter-sort ×7, selection-summary ×4, preset registry ×6, segment-scope helper ×3, predicate-state ×11, playground-deeplink ×5).
- **Routes added:** `/api/preview`, `/api/segments/import-ids`, `/api/identity-map (merged GET + DELETE)`, `/api/settings/identity-map` alias.
- See `plans/260519-1610-query-results-to-segments/` for full plan and per-phase notes.

### Changed — Segments server port moved from `:3001` → `:3002`

- `:3001` collided with a local hermes catalog-api dev process. `server/src/index.ts` PORT default + `vite.config.ts` `/api` proxy target both moved to `:3002`. Override with the `PORT` env var if needed.

## 2026-05-19

### Added — Segments workspace foundation (P0 partial + P1 done)

- **New backend** under `server/` — Fastify + better-sqlite3 process listening on `:3001` with CRUD for `segments`, `segment_analyses`, `cube_identity_map`, `presets`; tree↔CubeQuery translator (all ops); `X-Owner` pretend-auth middleware; meta-version cache; dev-only `__fixtures__` seed endpoint. 23/23 unit tests green. Wired via Vite proxy `/api → :3001`; combined dev via `npm run dev:all`.
- **Design-system port (partial)** — 26 mock tokens added to `src/theme/tokens.css`; `--radius-pill` corrected from `8px` to `9999px`; 14 segment visual primitives + 4 chart wrappers (LineChart / BarList / Donut / Sparkline) landed under `src/pages/Segments/visuals/` with 32 Vitest tests.
- **Visual regression scaffold** — mock vendored to `tests/visual/mock-fork/`; Playwright config + `screens.spec.ts` + `playground-polish.spec.ts` + `capture-baselines.ts` scaffolded; `test:visual` / `visual:capture-baselines` scripts wired. Baseline PNG capture, CI gate, and existing-screen polish pass remain to be done.
- See `plans/260519-1610-query-results-to-segments/` for full plan; phase-00 status now Partial, phase-01 Done.

## 2026-05-17

### Added — New Metric: multi-source selection + N-slot inputs (Ratio cross-cube)

- `NewMetricDraft` migrated from `(sourceCube, ofMember, ofMemberB)` to the
  canonical multi-source / N-slot shape `(sourceCubes[], inputs{})`. Legacy
  fields kept in lock-step by the reducer so the dialog flow keeps working.
- `OperationDef.inputs: InputSlot[]` + `OperationDef.minSources: number`
  replace the old single `OperationAccepts` field. Ratio declares two numeric
  slots (`numerator`, `denominator`) and `minSources: 2`.
- **Step 1** now supports multi-select with a "Primary" badge and a
  "Make primary" affordance on selected non-primary cards.
- **Step 2** gates each operation card on `minSources` vs the current source
  count. Clicking a locked card snaps back to Step 1 with a brief pulse on
  the source toolbar.
- **Step 3** renders one slot-picker grid per `op.inputs[]` entry. Cross-cube
  measures are eligible when their cube is in `sourceCubes` and joinable.
- **YAML emitter** now produces `{cubeA}.x / NULLIF({cubeB}.y, 0)` for
  cross-cube ratio; same-cube ratio output is byte-identical to before.
- Validator drops the cross-cube ratio ban; new error keyed by `inputs.<slotId>`
  when a required slot is empty.

## 2026-05-16 and earlier

See `git log` for full history. Highlights:
- Full-page New Metric wizard rebuild (`/metrics/new?v=2`), 6-step flow.
- CDP projection + Catalog UI iterations.
- New Metric polish: shell layout, compact operation pills, live auto-name.
