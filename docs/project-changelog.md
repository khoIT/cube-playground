# Changelog

Significant changes to the cube-playground app, newest first.

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
