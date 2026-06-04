# Changelog

Significant changes to the cube-playground app, newest first.

## 2026-06-05 — Per-member 360 page (live Cube, config-driven)

New route `/#/segments/:id/members/:uid`: clicking a member in a segment's Members tab opens that member's full 360, rendered live from Cube. Plan: `plans/260605-1200-per-member-360-page/`. Builds on the already-ported cfm `user_360.yml` substrate (no re-port). Tests: 17 new FE (`member360-data-layer`); full Segments suite 161 green; build clean.

- **Config-driven panel registry** (`src/pages/Segments/member360/member360-panels.ts`), per game: **cfm** = full set (profile + roles/devices[PII]/ips[PII] + daily/monthly timelines + 10 lazy FPS event-stream "Behavior" panels); **ballistar** = core subset (profile + timelines + transactions). Built ballistar too because every existing segment is ballistar — keeps the feature reachable. cros/tf are later config-only adds.
- **Single-member live hook** (`use-member-cube-query.ts`): reuses the proven `cube-member-resolver` physicalize/logicalize + cube client + a 3-concurrency cap; sends the query verbatim (no segment slice filters, unlike `useSegmentCubeQuery`).
- **Guardrail-safe behavior section**: 1M–1.3B-row `etl_*` panels query only on expand, each bounded by an `inDateRange` filter on `<view>.log_date` (preset 7/14/30d, all ≤ cube.js `MAX_RANGE_DAYS=31`); playerid bridge resolves the user's `role_id`s once (`user_roles_panel`) then filters `playerid IN role_ids`; a test asserts the registry's behavior views ⊆ `BEHAVIOR_VIEWS`.
- Generic renderer (`member-panel.tsx`) dispatches profile (KPI cards + vitals) vs table; design-token styling; PII chip on device/IP panels. Members pre-classified dimension-vs-measure from the cube YAMLs to avoid silent-empty.
- **Pending**: in-browser value reconcile vs Trino/dashboard (standalone curl blocked by the in-app game-claim auth plumbing).

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
