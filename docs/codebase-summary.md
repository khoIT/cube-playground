# Codebase summary

High-level map of the cube-playground app, updated as features ship.

> For the runtime tiers (SPA / gateway `:3004` / chat-service `:3005` / Cube) and how they talk, see [`system-architecture.md` → System Overview](./system-architecture.md#system-overview). This doc is the file-location map; that one owns topology + request flows.

## Top-level layout

- `src/shell/` — **Hermes-derived app shell**. Sidebar (260↔60 collapse) + Topbar (56px sticky, blur backdrop) + theme tokens. See `plans/260523-1131-hermes-shell-mirror/` for the port plan. `T` proxy + `Icon` + `cx` exports live in `src/shell/theme.tsx`. CSS vars `--hermes-*` in `src/theme/tokens.css` coexist with cube's existing `--brand`/`--bg-card`.
- `src/pages/Liveops/` — **Liveops console foundation** (2026-05-25, Phase 1). `/liveops` route hosts a 5-tile KPI hero strip (DAU / MAU / Revenue / Paying / ARPDAU) with sparklines + delta %, auto-refreshing every 45s. Placeholder for anomaly inbox (Phase 2) and saved dashboards (Phase 3). Reuses `KpiTile`, `Sparkline`, `LiveBadge` visuals from Segments.
- `src/stores/chat-stream-store.ts` — **Chat streaming singleton** (2026-05-24). Zustand store keyed by sessionId; survives unmount when switching between side-panel and `/chat/:id` view. Handles SSE open/attach/cancel; uses `aliases` map to re-key entries when `session_created` / `compact_warning` events change sessionId without render flicker. Factory-free singleton (not Context) because stream lifecycle must outlive component mounts.
- `server/` — **Fastify + better-sqlite3** backend on `:3004` (Vite proxy `/api → :3004`). Persists segments / analyses / identity-map / presets. Pretend-auth via `X-Owner` header. Translator service maps the canonical AND/OR predicate tree to Cube `Query.filters` and back. See `server/README.md`.
- `chat-service/src/core/stream-registry.ts` — **Server-side streaming registry** (2026-05-24). Per-turn in-memory ring buffer (STREAM_REGISTRY_RING_SIZE=2000) + listener set. Powers `GET /agent/turn/:turnId/stream?from=<offset>` replay endpoint. Stores UUID v4 turnId + events; client refreshes can attach from buffered offset and tail live via `GET /api/chat/sessions/:id/stream-replay`. Supports compact-session alias via `aliasSession(old, new)`. Session-fetch response includes `activeTurnId` from `findRunning(sessionId)`. Background sweeper drops finished entries after TTL.
- `src/pages/Segments/visuals/` — 14 bespoke visual primitives (LiveBadge, MemberPill, KpiTile, SelectionBar, …) + 4 chart wrappers (LineChart / BarList / Donut / Sparkline) used by the Segments workspace. Ported from the design mock at `tests/visual/mock-fork/`.
- `tests/visual/` — Playwright visual-regression suite (`test:visual` script). Baselines live under `baselines/{1440x900,375x812}/`; mock-fork is the canonical source for capture (`capture-baselines.ts`). Currently scaffolded; baseline PNGs not yet committed.
- `src/QueryBuilderV2/NewMetric/` — the **data-model wizard** (despite the dir
  name; it actually edits cube YAML: artifactKind = measure | dimension | segment).
  - **Full-page wizard** at `/data-model/new?v=2` (`full-page/NewMetricPage`).
    Six steps: Source → Operation → Column → Filters → Identity → Test run.
    Legacy `/metrics/new?v=2` 301s here.
  - **Legacy modal** (`NewMetricDialog.tsx`, `legacy-new-metric-dialog-mount.tsx`)
    is `@deprecated` — entry points removed from `QueryStatePillBar` and the
    user-menu in the 2026-05-23 redesign. Files kept one release; delete after.
- `src/pages/Catalog/metric-composition-wizard/` — `/catalog/metric/new`,
  lean 4-step business-metric registration form. POSTs to
  `/api/business-metrics`. This is the lightweight "Add Metric" CTA target on
  the Catalog metrics tab.
- `src/shared/game-scoping/apply-game-filter.ts` — pure util that merges
  `{ <cube>.gameId equals activeGameId }` into a Cube `Query` for every
  referenced cube that exposes a `gameId` dim. Used by `QueryTabsRenderer`
  in Playground.
- **Server-side game scoping** (2026-05-23):
  - `server/src/routes/cube-token.ts` → `GET /api/playground/cube-token?game=<id>`
    returns `{ token, source }`. Token strategy: env `CUBE_TOKEN_<GAME>`
    overrides, otherwise mint HS256 with `CUBEJS_API_SECRET`, otherwise
    `CUBE_TOKEN` fallback, otherwise `null`.
  - `server/src/services/sign-cube-token.ts` — `node:crypto`-based HS256 signer
    matching Cube's `checkAuth` contract.
  - `src/hooks/use-cube-token-bootstrap.ts` — frontend orchestrator. On every
    `GameContext.gameId` change it fetches a token and calls
    `SecurityContextContext.saveToken`, so the next Cube request carries the
    correct `game` claim and Cube's `repositoryFactory` loads the right yaml.
  - `cube-dev/cube/cube.js` carries a `GAME_ALIASES` map
    (`cfm_vn → cfm`, `jus_vn → jus`, `ballistar_vn → ballistar`) so the
    frontend's `gds.config.json` ids align with Cube's canonical schema keys.

## App shell (2026-05-23)

- **Sidebar IA**: Chat / Playground (flat) / Data Model / Metrics Catalog / Segments / Advanced (5 sub-items). Collapse state persisted to localStorage key `gds-cube:sidebar:collapsed`; per-section expand state in `gds-cube:sidebar:section:{id}`. Auto-expands on route change via longest-prefix matcher in `sidebar-section-store.ts`.
- **Recent items LRU**: 8 entries × 4 modules in `gds-cube.recent.v1.{module}`. Pushed by `RecentItemPusher` in `App.tsx` on route change.
- **Topbar trailing**: Pages call `useTopbarTrailing(node, deps, active)` to register their action bar (e.g. "+ New segment", "Refresh", "Activate to CDP"). The `active` flag (typically from `useRouteMatch()`) is REQUIRED because `KeepAliveRoute` keeps sibling pages mounted; without it, hidden pages clobber the active page's actions.
- **WhatsNewBell + announcement inbox**: Topbar bell (`WhatsNewBell`, `src/pages/WhatsNew/whats-new-bell.tsx`) replaces former AnomalyBell + chat NotificationBell (files on disk but unused). `/whats-new` page hosts feature cards for releases; each card leads with a full-bleed 21:9 hero SVG (`public/whats-new/*.svg`), cards lift on hover. Content = bundled markdown files in `src/pages/WhatsNew/releases/*.md` with `image:` frontmatter (parsed via Vite `?raw` glob in `announcements-content.ts`); adding a release = drop a .md file + hero SVG (no server changes). Inbox policy: only features reachable by any user (admin-gated features excluded). Per-user read-state: server migration 052-announcement-reads.sql, routes/announcements.ts, GET/POST `/api/announcements/reads` (owner-scoped). Shared module `use-announcements.ts` syncs bell + page.
- **GamePicker**: Sits in Topbar's `fixedTrailing` prop (not via context) so it cannot be overwritten by per-page registrations.
- **App.tsx refactor**: `SmartSearchProvider > TopbarTrailingProvider > shell-flex(Sidebar + main(Topbar + scroll children))`. Routes: `/` → `/build` redirect, `/chat` → `ChatPlaceholderPage`, `/catalog` (exact) → `/catalog/data-model` redirect.
- **Header.tsx deprecation**: Kept on disk one release for safety; App.tsx no longer renders it (tests-only). Delete after next release.
- **Catalog IA (2026-06-12)**: Data Model subtabs reordered: **Cubes, Schema, Concepts, Models, Concept Map** (was Schema-first). Root `/catalog/data-model` now lands on **Cubes (Graph-default view)** with `?view=grid` toggle (URL-derived, `history.replace`, reusable toggle controls via `cubes-surface.tsx`). Schema Cartographer moved to `/catalog/data-model/schema` (from root). Legacy routes 301-chain: `/catalog/schema?focus=X` → `/catalog/data-model/schema` (focus preserved for chat field-chips); `/catalog/cubes` + `/data-model/cubes?view=grid` → root; `/catalog/data-model` → Cubes root. Cubes module components: `cubes-surface.tsx` (Graph ⇄ grid toggle owner), `cube-graph-page.tsx` (lazy reactflow), pure-TS graph builder (`build-join-graph.ts` parses extended-meta joins + keyed edges, cluster-grid layout `cluster-grid-layout.ts`, `view-composition.ts` for view→cube sets, `cubeBaseName` strips prod `${gamePrefix}_` + legacy `__` prefixes for prefix-workspace clustering). Root `/catalog/data-model` redirect matrix in `catalog-page.tsx`: root + `?focus=` → Schema; search preserved + history.replace. `CatalogBrowseBody` extracted from `catalog-page.tsx`. `use-catalog-meta.ts` extended: additive `aliasMember?: string` on CatalogMeasure/CatalogDimension.

## New Metric draft model

The wizard's draft (`NewMetricDraftV2`) carries a canonical multi-source /
N-slot shape plus parallel legacy fields kept in lock-step by the reducer:

```
sourceCubes: string[]                   // primary cube is index 0
inputs: Record<string, string | null>   // slotId → qualified member name
                                        //   "value" for scalar ops
                                        //   "numerator" + "denominator" for ratio

// Legacy mirrors — synced automatically by useNewMetricDraft's reducer.
// Read by the legacy dialog flow; new code should prefer the canonical pair.
sourceCube:  string | null              // = sourceCubes[0] ?? null
ofMember:    string | null              // = inputs[primarySlotIdFor(op)]
ofMemberB:   string | null              // = inputs.denominator (ratio only)
```

`OperationDef` declares `inputs: InputSlot[]` + `minSources: number`. Ratio
is `minSources: 2` with two numeric slots; all other ops are `minSources: 1`
with one optional or required slot.

## Step gates and validation

- **Step 1 → 2**: `sourceCubes.length >= 1`. Picking multiple cubes is allowed.
  The first selected is the primary (where the YAML measure file lives); the
  rest expand the reachable-member pool for Step 3.
- **Step 2 → 3**: `operation` set. Cards whose `minSources > sourceCubes.length`
  render as locked; clicking one snaps the user back to Step 1 with a
  transient pulse on the source toolbar.
- **Step 3 → 4**: every required slot in `op.inputs` is filled.
  Cross-cube ratio is allowed — the YAML emitter uses each member's own
  `cubeName` to produce `{cubeA}.x / NULLIF({cubeB}.y, 0)`.

`useReachableMembers` accepts either a single cube name or an array.
Multi-source consumers pass the full `sourceCubes`; the hook unions reachable
members from every selected cube and de-dupes by qualified name.

## Key files

- `hooks/use-new-metric-draft.ts` — reducer + parallel-sync + hydration migration
- `hooks/use-reachable-members.ts` — multi-source-aware join walker
- `full-page/hooks/use-eligible-columns.ts` — slot-aware column filter
- `full-page/steps/step-2-operation/operations.ts` — 9 op definitions + slot schema
- `full-page/steps/step-3-column/{column-body,slot-picker}.tsx` — N-slot UI
- `yaml/generate-measure-yaml.ts` — YAML emitter (single & cross-cube ratio)

## Optimization Advisor In-Process Agent Runtime

### Server-side runtime (server/src/advisor/agent/)

- **`agent-runtime.ts`** — `createAdvisorAgentSession()` factory; one session = multi-turn investigation. Uses `@anthropic-ai/claude-agent-sdk` `query()` in-process; streams `RuntimeEvent`s per turn. Dual stop: `interruptTurn()` (abort in-flight, resumable) vs `abort()` (close).
- **`agent-oauth-env.ts`** — Subscription OAuth lane isolation. `buildAgentEnv()` strips API-key/gateway vars from long-lived `process.env` before SDK subprocess spawn. Resolves token from `CLAUDE_CODE_OAUTH_TOKEN` OR `ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN` (Vault name), injects canonical. Missing → 503 OAuthTokenMissingError.
- **`agent-guardrails.ts`** — Deny-by-default `canUseTool` gate (only `mcp__advisor__*` allowed); caps `maxTurns=12`, `maxBudgetUsd=1.0`, `timeoutMs=120000` (env-overridable).
- **`agent-inbound-guard.ts`** — Redacts emails/PII, defangs prompt-injection/role-impersonation in inbound text.
- **`agent-provenance-gate.ts`** — Hybrid "free Explore, gated Decide" rule. Per-session `ProvenanceLedger` registers tool results under stable `provenanceId` (`${tool}#${seq}`); `validateDraftNumbers` ensures recommendation cards only cite validated numbers.
- **`agent-redaction-guard.ts`** — Allow-by-shape: only `user_id` + numeric + reachability columns + Cube keys reach agent; strips contact PII.
- **`agent-context-pack.ts` / `agent-system-prompt.ts`** — Pure context injection (goal trees, lever taxonomy, playbook index, scope).
- **`tools/`** — 10 deterministic advisor-engine wrappers: diagnose, recommend, map_levers, check_power, expected_incremental, list_priors, scaffold_draft, cube_query, cube_meta, predicate_compile (names `mcp__advisor__*`). Numbers come from these, never LLM free-text.
- **`experiment-quality-score.ts`** — Pure quality scorer (power / feasibility / ₫-materiality / provenance / goal-fit) backing offline eval + live smoke.
- **`advisor-run-store.ts`** — SQLite persistence API for audit: `persistTurn()` (transactional write), `listRuns()`, `getRunDetail()`, `listEvents()`, `listOwners()`, `pruneOlderThan()`. 4 tables: `advisor_agent_run`, `advisor_agent_turn`, `advisor_tool_call`, `advisor_event_log`. Lazy once-per-process prune > `ADVISOR_AUDIT_RETENTION_DAYS` (30 days).
- **`run-recorder.ts`** — Recorder seam: `RunRecorder` interface + `sqliteRunRecorder` (default, swallows errors) + `noopRunRecorder` (tests). Injected via `deps.recorder`. Buffers events per turn, pairs tool calls by `callId`, flushes in `finally` (never breaks a live turn).

### API routes

- **`server/src/routes/advisor.ts`** — **`POST /api/advisor/agent/turn`** (SSE turn stream) + existing `POST /api/advisor/diagnose`, `POST /api/advisor/recommend`. Returns 503 `{code:'oauth_unavailable'}` / 409 `{code:'turn_in_progress'}`.
- **`server/src/routes/admin-advisor-audit.ts`** — Admin audit routes (`requireRole('admin') + requireFeature('admin')`): `GET /api/admin/advisor/runs` (filterable list), `GET /api/admin/advisor/runs/:sessionId` (full detail), `GET /api/admin/advisor/runs/:sessionId/events` (append-only SSE replay), `GET /api/admin/advisor/owners` (owner list). Registered in `src/index.ts` next to `adminChatAuditRoutes`.

### Frontend wiring (src/pages/Advisor/)

- **`drive-panel.tsx`** — UI for live LLM agent mode ("Guided Drive"); streams agent SSE and renders turns.
- **`use-drive-session.ts`** — Hook managing session lifecycle + turn request/response cycle.
- **`investigation-reducer.ts`** — State machine for multi-turn investigation (Opportunity → Target → Cause → Lever → Proof).
- **`number-badge.tsx`** — Displays validated numbers with provenance indicator.
- **`streamAgentTurn` in src/api/advisor.ts** — Client-side SSE consumer, normalizes `RuntimeEvent`s.

Existing simulator ("Explore" posture): `src/pages/Advisor/use-advisor-investigation.ts` `simulateInvestigation` (no LLM).

### Admin audit UI (src/pages/Admin/hub/)

- **`advisor-audit-panel.tsx`** — Tab in `dev-hub-panel.tsx` (3-pane: filters / run list with failure badges / run detail). Responsive to game/owner/stop-reason filters.
- **`advisor-audit-run-detail.tsx`** — Turn timeline + tool-call rows + lazy paginated SSE replay + failure-hint banner (next-step guidance per failure type).
- **`advisor-audit-data.ts`** — Client API consumer for audit routes; paginated fetches.
- **`advisor-failure-hints.ts`** — Pure mapping: failure enum → human-readable hint (e.g. cold-Trino timeout → "warm up query window", budget → "increase cap", aborted → "check guardrails", error/denied → error details).

---

## Agent injected-context & ask-frugality (chat-service)

Pushed context that makes the chat agent model-aware and ask-frugal. All blocks
assembled in `compose()` (`chat-service/src/core/mode-prompts.ts`), each behind a
default-off flag in `config.ts` (`AGENT_MODEL_DIGEST_ENABLED`,
`AGENT_RESOLVED_CONTEXT_ENABLED`, `AGENT_SMART_DEFAULTS_ENABLED`,
`AGENT_MODE_GOVERNS_POSTURE`, `AGENT_ENGINE_ROUTING`). See
[`system-architecture.md` → Agent injected-context pipeline](./system-architecture.md#chat-disambiguation-memory).

- **Contracts** — `chat-service/src/core/agent-context-types.ts` (`ModelGraphDigest`, `ResolvedContext`).
- **Model-graph digest** — `chat-service/src/core/model-graph-digest.ts` (`buildDigest`/`renderDigest`/`getModelDigestText`); memoised on the meta-version hash; resolved in `api/turn.ts` and injected into the cacheable prefix.
- **Resolved-context** — `chat-service/src/core/resolved-context.ts` (`readResolvedContext`/`renderResolvedContext`) over the L1 disambiguation memory; injected into the volatile tail. Continuity write-back in `tools/emit-query-artifact.ts` (single-measure metric + explicit window).
- **Smart defaults** — `chat-service/src/core/smart-defaults.ts` (`resolveRevenueDefault`/`renderSmartDefaults`); revenue default via the glossary.
- **Grain gate** — `chat-service/src/nl-to-query/clarification-builder.ts` drops `refKind==='ratio'` from leaderboard options for user-grain entities (threaded from `nl-to-query/index.ts`).
- **Shared join-graph** — `chat-service/src/shared/cube-model-graph/build-join-graph.ts` is a byte-identical vendored copy of `src/pages/Catalog/cube-graph/build-join-graph.ts`; drift-guard at `chat-service/test/cube-model-graph-drift.test.ts`.
- **Eval** — corpus `chat-service/test/agent-intelligence-eval/corpus.json`; live runner `chat-service/src/scripts/run-agent-intelligence-eval.ts`; deterministic sub-checks in `test/core/*` + `test/nl-to-query/clarification-builder-grain-gate.test.ts`.
- **Toggle (FE)** — `src/pages/Settings/use-chat-disambiguation-mode.ts` default is now `aggressive`; strings relabelled in `src/i18n/locales/{en,vi}.json`.

---

## Unified Concept Fabric (trust registry + reverse index + authoring)

### Services (server-side)

- **Trust mapping** — `server/src/services/trust-mapping.ts`. Derives unified trust ∈ {draft, certified, deprecated} and visibility ∈ {personal, shared, org} on read from legacy YAML `trust` + `trustTier` for metrics, glossary `status` columns, and segments `visibility` column (default personal).
- **Concept reverse-index** — `server/src/services/concept-reverse-index.ts`. Caches per (workspace, game): field→metrics edges, metric→fields, field/term→segments. Invalidated on glossary/metric/segment writes. Serves `GET /api/concepts/:namespace/:id/relations`.
- **Concept ref integrity** — `server/src/services/concept-ref-integrity.ts`. Guards delete operations: returns 409 if any glossary term or metric references a segment/metric being deleted.
- **Promote to term** — `server/src/services/promote-to-term.ts`. Atomic promotion: segment → draft glossary term + optional metric stub. IDOR-safe (workspace-scoped).

### Routes (server-side)

- **`routes/concepts.ts`** — `GET /api/concepts/:namespace/:id/relations` (returns typed edges with trust badges).
- **`routes/concept-promote.ts`** — `POST /api/concepts/promote` (segment → term/metric, editor+, IDOR-safe).
- **`routes/glossary.ts`** — Extended with `secondaryCatalogIds` validation + dangling-ref guard on POST/PUT/DELETE.

### Frontend

- **Concept resolution** — `src/pages/Catalog/glossary/resolve-concept.ts`. Type dispatch + action routing + serialization. Integrates with Chat, Segments, Catalog.
- **ConceptChip** — `src/components/concept-chip/concept-chip.tsx`. Glyph + label + trust badge; interactive (click→navigate, hover→card delay).
- **ConceptHoverCard** — `src/components/concept-hover-card/concept-hover-card.tsx`. Throttled relation fetch + categorized edges (used_by, composed_by, filtered_by) + layer filter.
- **Glossary row** — `src/pages/Catalog/glossary/glossary-row.tsx`. Extended with secondary-ref chips via ConceptChip.
- **Segments row actions** — `src/pages/Segments/library/row-actions-menu.tsx`. "Promote to glossary term" affordance.
- **Schema Cartographer detail** — `src/pages/Catalog/schema-cartographer/member-detail-panel.tsx` + new `concept-relations-section.tsx` + `layer-filter-pills.tsx`. Reverse-edge explorer with `?focus=namespaced-ref` routing.
- **Concept Map** — `src/pages/Catalog/concept-map/` (Data Model subtab `/catalog/data-model/concept-map`, lazy-loaded). reactflow node graph of all 4 concept layers. NEW `useConceptGraph` index (separate from cube-bound `useCartographerIndex`); focus-scoped edges via `useFocusEdges`; pure `build-layout.ts` (4 columns + per-layer cap); token-styled nodes (`--layer-*`); `?focus=` deep-links all 4 namespaces. Reuses the Cartographer's `parseFocusRef`, `LayerFilterPills`, `CartographerSearch`, ConceptChip icon vocab.
- **Chat assistant message** — `src/pages/Chat/components/assistant-message.tsx`. Glossary term references rendered as inline ConceptChips.
- **Client** — `src/api/concepts-client.ts` (typed GET /api/concepts/:namespace/:id/relations).

---

## Activity Telemetry & Admin Observability

Append-only event spine + admin aggregation routes for workspace usage observability. All events keyed by actor `sub` (Keycloak subject).

### Services (server-side)

- **Activity store** — `server/src/services/activity-store.ts`. Core CRUD: `recordActivity` (fire-and-forget), `insertActivity`, `queryActivity`, `projectQueryShape` (PII allowlist), `distinctActorsSince`, `topEventTargets`, `pruneActivityBefore`. Non-blocking, logs but never throws on disk-full.
- **Event types** — `server/src/services/activity-event-types.ts`. Closed enum: `query_run`, `segment_op`, `feature_open`, `export`, `workspace_switch`.
- **Activity aggregator** — `server/src/services/activity-aggregator.ts`. Org-wide and per-user summaries: active counts, inactive list, top features, query-shape profiles, chat stats bridge (timeout-safe). Resolves email→sub via `user_access.kc_sub`.
- **Chat stats client** — `server/src/services/chat-stats-client.ts`. Calls `GET /internal/stats` on chat-service with timeout + error degradation (null counts when unavailable).

### Routes (server-side)

- **`routes/activity.ts`** — `POST /api/activity` (client-forged allowlist: `feature_open`, `export`, `workspace_switch`; actor resolved from auth token).
- **`routes/admin-activity.ts`** — `GET /api/admin/activity/summary` (org rollup) and `GET /api/admin/activity/users/:email` (per-user deep-dive). Both admin-gated.

### Chat service bridge

- **Internal secret gate** — `chat-service/src/middleware/internal-secret.ts`. Validates `INTERNAL_SECRET` header; never fails open (403 if missing/wrong). Differs from server's `GET /internal/access` (fails open under `AUTH_DISABLED`).
- **Stats endpoint** — `GET /internal/stats` (bulk query by `sub[]`). Returns per-user turn count, cost, last-active timestamp.

### Jobs

- **Prune activity events** — `server/src/jobs/prune-activity-events.ts`. Daily, hard-deletes events older than 90d. Logs count.

### Migrations

- **029-activity-events.sql** — `activity_events` table (`actor_sub`, `event_type`, `target_type`, `target_id`, `workspace`, `game`, `detail_json`, `ts`). Indices on `(actor_sub, ts)` and `(event_type, ts)`.

### Frontend (Admin Hub)

The redesigned `/admin` page splits user governance from activity observation into two tabs with dedicated modules:

**Access (Users & Grants) tab** (`/admin/access`):
- **`users-and-access-tab.tsx`** — Users list, per-user selection, lean identity/grants layout.
- **`per-user-panel.tsx`** — Identity strip + role/status controls + workspace/game/feature grants. Fetches light session count via `GET /api/admin/activity/users/:email/sessions?limit=5` for a badge (not full activity).
- **`per-user-panel-helpers.ts`** — Utility functions for grant aggregation + display formatting.
- **`access-controls.tsx`** — Card-based grant UI: workspace/game/feature selection + inline approve/deny for pending users.
- **`feature-access-section.tsx`** — Feature matrix grid for granular capability assignment.

**Observability (Activity Telemetry) tab** (`/admin/observability`):
- **`observability-tab.tsx`** — Org-level KPI strip (7d/30d active users, total queries, top features) + pending-approval queue promotion + inactive users list + audit log viewer.
- **`pending-approval-queue.tsx`** — Dedicated queue for users awaiting role assignment. One-click Approve (PATCH `{status:'active', role}`) or Deny (PATCH `{status:'disabled'}`). Live "N pending" badge on tab.
- **`user-activity-profile.tsx`** — Shareable drill-in sub-route `/admin/observability/:email`. Segmented toggle: Access lens (reuses `AccessControls`) | Activity lens (full vitals + timeline).
- **`activity-profile.tsx`** — Activity lens detail: last login + segment count + recent features + chat stats (turns, cost, last-active). Imported by drill-in.
- **`session-timeline.tsx`** — Visual session bands (time range + event list per session). Powers the Activity lens timeline.
- **`cross-user-audit-panel.tsx`** — Org-level audit log viewer (filtered by actor/action/target/date).
- **`audit-log-viewer.tsx`** — Reusable audit entry list component.
- **`observability-data.ts`**, **`cross-user-audit-data.ts`** — Data fetching + transformation (types + client calls).

---

## Cube-model onboarding (bootstrap → reconcile → repair lifecycle)

The data-analyst onboarding flow bootstraps draft Cube models from raw warehouse schemas, feeding the existing drift-center and metric-coverage surfaces.

### Services (server-side)

- **Profiler** — `server/src/services/trino-{profiler,rest-client}.ts` + `trino-profiler-config.ts`. Fetch-based warehouse connector; zero npm deps; creds gated & redacted.
- **Inference** — `raw-schema-inference.ts`. Column profiles → Cube skeleton (dims/measures/time/PK/joins) with confidence + warm/cold mode prior.
- **Scaffolder** — `cube-model-scaffolder.ts` + `types/cube-model.ts` Zod. Inferred schema → Zod-valid Cube model + block-style YAML.
- **Staging** — `onboarding-draft-store.ts` (pending → accepted → rejected → written lifecycle; upsert preserves states). Migration 023: `onboarding_draft_models` table + audit.
- **Enrichment** — `cube-model-enrichment.ts` (LiteLLM member-name enrichment; hallucination-filtered). Flag: `onboarding.llmEnrichment`.
- **Golden seeding** — `golden-query-seeder.ts` (dashboard_tiles + chat DB co-occurrence mining). Flag: `onboarding.goldenSeeding`.

### Routes (server-side)

- **`routes/onboarding.ts`** — GET connectors/introspect, POST generate, drafts CRUD, accept/reject, validate, approve. Writes YAML via `cube-model-writer.ts` (atomic + .bak rollback). RBAC via `enforce-write-roles` + self-approve guard.

### Frontend

- **Pages** — `src/pages/Data/` + `/data` route. Connectors → connector detail (Datasets/Agents/Coverage/Drift/History tabs) → dataset tables + mode pick → triage canvas.
- **Triage canvas** — 3 interchangeable views (queue+YAML / entity-graph / conversational) over shared `use-onboarding-draft` engine. Per-user pref: `onboarding.triageView`.
- **Client** — `src/api/onboarding-client.ts` (typed API calls).

---

## Chat-Driven Segment Creation (Measure-Threshold / Top-N / Percentile)

### Services (server-side)

- **Segmentable measures catalog** — `server/src/services/segmentable-measures-catalog.ts`. Loads static allowlist `data/segmentable-measures.json` (cfm_vn + jus_vn measures + over-population specs). `isCatalogTarget(game, measure)` gates `/api/segments/segmentable-measures` + `/api/segments/resolve-cutoff`.
- **Segment cutoff resolver** — `server/src/services/segment-cutoff-resolver.ts`. Compiles a measure + population scope + percentile into a per-user cutoff via percentile-cutoff-resolver. Handles jus dual-identity merge: `split_part(user_id,'@',1) + max() + GROUP BY`. Returns cutoff value, population count, estimated matching member count.
- **Cutoff generator script** — `server/src/scripts/derive-segmentable-measures.mjs`. Derives `segmentable-measures.json` from game configs + Cube `/meta`. Probes each candidate measure against cfm_vn/jus_vn to populate currency, population, over-dimension, and calibrate thresholds. Manual-run script (not automated).

### Routes (server-side)

- **`GET /api/segments/segmentable-measures?game=<id>`** — Returns `{ measures: [{concept, label, dimension, window, currency, over}] }` from the allowlist, scoped to game. No auth requirement (read-only product info).
- **`POST /api/segments/resolve-cutoff`** body `{game_id, p, gte, over}` — Returns `{cutoff, populationCount, estCount}` (numeric preview at propose time, no segment written). Used by chat propose-card to show "est. 10,251 members" before FE posts create.

### Chat service bridge

- **`tools/propose-segment.ts`** — Emits `segment_proposal` SSE event. Calls `/api/segments/resolve-cutoff` to preview count. Payload: measure, percentile (or top-N→percentile), estimated count, predicate leaf (gte/lte).
- **`tools/get-segmentable-measures.ts`** — Calls `GET /api/segments/segmentable-measures?game=<id>` to populate the measure picker in chat UI.
- **`utils/cube-query-to-predicate-tree.ts`** — Translates Cube query + measure spec into a PopulationRef (filter + identityMerge) for the predicate tree. Reused by both segment proposal and general query-to-predicate pathways.

### Frontend

- **`src/pages/Chat/components/segment-proposal-card.tsx`** — Renders chat's `segment_proposal` SSE event. Shows measure + percentile + "est. N members" + action buttons (Create / Decline). POSTs `/api/segments` on Create. Integrates with segment detail deep-link on success.
- **`src/api/segment-proposal.ts`** — HTTP client: `POST /api/segments` with proposal payload → new segment.

---

## Segment Revamp (LTV Tiers, Member-360, Sharing, AI Brief)

### Services (server-side)

- **LTV-tiered sampling** — `member360-panel-registry.ts` enumerates `[Engagement, Retention, Revenue, …]` panels per game; `refresh-segment.ts` computes top/middle/bottom-50 tiers by preset `ltvMeasure` at segment refresh time, stores `member_tiers_json` (50 rows per segment; migration 032).
- **Member-360 precompute** — `member360-precompute-scheduler.ts` schedules nightly window 02:00-06:00 GMT+7 (MEMBER360_PRECOMPUTE_WINDOW), fetches cached panel rows for each tiered member via Cube `/load`. Writes to `segment_member360_cache` (migration 033); per-uid status ok/error for FE chips.
- **Segment brief cache** — `segment-brief-store.ts` single-flight per (segment, lang); `segment-definition-hash.ts` fingerprints predicate tree so renames reuse cache, edits regenerate. `segment-brief-context.ts` assembles Cube rows + definition context for LLM. Migration 035: `segment_brief_cache(segment_id, lang, definition_hash, brief_json, status, generated_at)`.
- **Segment sharing labels** — `owner_label` (human-readable "shared by …" stamped at create) + `shared_at` timestamp on share endpoint (migration 034). Legacy NULL rows fallback to owner sub on read.

### Routes (server-side)

- **`routes/segment-brief.ts`** — `GET /api/segments/:id/brief?lang=en|vi&refresh=1` serves cached narrative + 5-label enum schema. Generates on cache miss; `?refresh=1` rate-limited 10 min/segment/lang. Stale-serve on LLM failure with 2-min backoff.
- **`routes/segment-member360.ts`** — `GET /api/segments/:id/members/:uid/panels` (cached per-uid Cube rows), `GET /api/segments/:id/member-cache-status` (ok/error aggregate), `POST /api/segments/:id/precompute-members` (manual trigger, 10-min cooldown).
- **`routes/segments.ts`** extended — `POST /api/segments/:id/share` / `/unshare` (owner/admin-only, updates shared_at + visibility).

### Chat service bridge

- **`POST /internal/segment-brief`** (x-internal-secret gated) — Accepts context + lang, returns `{label, narrative, signals[]}`. Single SDK call via failover keys (CHAT_BRIEF_MODEL env, default claude-sonnet-4-6). 5-label enum schema (status/content/usage/quality/reach).

### Frontend

- **`AiBriefCard`** — Sticky detail-view header card. Sparkle eyebrow + label chip (semantic tokens per status), plain-text narrative + bullet signals, mandatory AI byline. Collapse state persisted (gds-cube:segment-brief-collapsed), expanded by default.
- **`use-segment-brief`** hook — Lazy fetch while card open; request-id guard vs stale overwrites; lang-aware refetch via ?lang; retry via ?refresh=1 (client capped @ 1 per 10 min).
- **Member-360 tabs** — Members tab renders tiered bands (top/middle/bottom-50) + per-tier panel cards (chart/KPI/table per game's corePanels). Cache-first + live fallback; status chips (ok/error/stale). Trigger manual precompute via 10-min-cooldown button.
- **Segment list Shared pill** — Sidebar & detail sidebar display "Shared" pill when `shared_at` is non-NULL; click → modal listing collaborators (by owner_label).
- **Client** — `segments-client.ts` extended with `getBrief()`, `getMemberCacheStatus()`, `getMemberPanels()`, `share()`, `unshare()` calls.

---

## CS Care Tab on Segment Detail (2026-06-13)

New "Care" tab on predicate segment detail pages for VIP/whale segments, overlaying CS support history + directional recharge impact. Gated to segments of CS-covered games (jus_vn, cfm_vn); renders coverage metrics, recent ticket pulse, issue taxonomy, top-risk watchlist, and recharge-outcome attribution.

### Services (server-side)

- **CS product-game map** — `server/src/lakehouse/cs-product-map.ts`. Seeds game-to-ticket-system lookups (jus_vn → 832, cfm_vn → 856); gates availability on static coverage list.
- **CS Trino connector resolver** — `server/src/lakehouse/cs-trino-connector.ts` exporting `resolveCsTrinoConnector()`. Tries profiler connector first (TRINO_PROFILER_* / connectors.config.json / DB-stored, configured locally), then falls back to Cube's connector (CUBEJS_DB_*, always set on prod). Returns null only if both unresolved. CS tables are fully qualified (iceberg.cs_ticket.*) so the session catalog is moot — either connector succeeds. Enables Care tab to work on prod without duplicate profiler env config.
- **CS ticket reader** — `server/src/lakehouse/cs-ticket-reader.ts`. Resolves Trino connector via `resolveCsTrinoConnector()`; queries `iceberg.cs_ticket.cs_ticket_new_master` + `cs_ticket_map_ai_label` (both multi-row per ticket; deduped via `row_number()`), groups by category/sentiment/rating. Serves pulse (open/unresolved/negative), issue mix (tickets/members per category).
- **CS recharge trajectory** — `server/src/lakehouse/cs-recharge-trajectory.ts`. Resolves Trino connector via `resolveCsTrinoConnector()`; joins contacted-member segment to recharge fact mart, computes impact window (members treated + control). Failure degrades `csImpact` to null (200) while other response sections remain.
- **Care-segment assembly** — `server/src/routes/segment-cs-care-assembly.ts`. Computes coverage %, freshness anchor, orchestrates ticket/recharge reads. 6h TTL cached.
- **Live member-name resolution** — `server/src/services/resolve-member-names-live.ts`. Resolves in-game names for bounded uid sets (≤60) via single identity-IN Cube query; fail-soft with 60s cooldown per segment. Segment refresh stores membership-only uids + top-1000 profile snapshot; members below cap have no stored name. Wired into watchlist (cs-care) and member detail (cs-tickets) — names cached with their 6h payloads.
- **Coverage calculation** — Membership cardinality vs contacted count; surfaces truncation flag if membership exceeds query limit.

### Routes (server-side)

- **`GET /api/segments/:id/cs-care`** — 404 if segment non-predicate or game has no CS coverage. Response: `{coverage{totalMembers,contactedMembers,pct,truncated},freshness{csMaxLogDate},pulse{tickets,contacted,openUnresolved,negativeSentiment,lowRating},issueMix[{category,tickets,members}],watchlist[{uid,name,ltv,lastCategory,lastSource,sentiment,rating,statusGroup,daysSince,riskScore}],csImpact{contacted,nonContacted,windowDays,smallSample}|null}`. Recharge-failure only: `csImpact→null`, rest populated. CS-read failure: 502.

### Frontend

- **Care tab entry** — `src/pages/Segments/detail/tabs/care-tab.tsx`. Registered in `detail-view.tsx` + `use-active-tab.ts` (DetailTabId gains 'care'); visibility gated to CS-covered games.
- **Care UI atoms** — `care-ui-atoms.tsx`. Reusable badge/pill components for status/sentiment.
- **Pulse strip** — `care-pulse-strip.tsx`. Open tickets + contacted members KPI cards; negative-sentiment + low-rating alert banners.
- **Issue mix** — `care-issue-mix.tsx`. Category breakdown (tickets, member count) with trend indicators.
- **Impact strip** — `care-impact-strip.tsx`. Recharge-outcome attribution for contacted vs control cohorts; `smallSample` warning.
- **Watchlist** — `care-watchlist.tsx`. Ranked risk members: LTV, last contact, sentiment, days-since, risk-score. Actionable for inline updates.
- **CSS** — `.careTab/.careRail/.careRailSide` in `segments.module.css`.
- **Client** — `src/api/segment-cs-care.ts` (typed GET call).

---

## Segment Predicate Explorer + Playground Round-Trip (2026-06-12)

Closes the build↔segment loop: refine a segment's definition in the Playground, save it back to the segment editor, and fully edit a segment's predicate through the UI (previously blind text editors). Five coordinated subsystems:

### Identity-anchor pivot sweep

- **`cube_identity_map`** — All 8 cubes that join mf_users (active_daily, ordered_event_funnel, ordered_funnel_canonical, user_active_rolling, user_gameplay_daily, user_roles, user_recharge_daily, user_recharge_rolling) now have rows anchoring their identity to mf_users.user_id. Global seeding across all games; audit confirmed no game-level semantics collisions (recharge excluded: ptg standalone / tf role-bridge + it already has a curated preset). Preset-less cubes now render "via mf_users" chip + enriched Members tab. Rows are data seeded via `PUT /api/identity-map/:cube` (`server/src/routes/identity-map.ts`) — no schema migration.

### Meta-driven member picker

- **Predicate-builder member field** (`use-predicate-member-catalog.ts`) — Live searchable Select fed by Cube `/meta` via server's `connectedComponent` reachability (FE deduplicates joined cubes). Auto-sets leaf `type`; on-focus distinct-value suggestions ((`use-dim-value-suggestions.ts`). Degrades to free-text when meta unavailable. Replaced hardcoded `Input` in `predicate-leaf.tsx:35`.
- **Dim value suggestions** — `use-dim-value-suggestions.ts` — lazy on-focus Cube `/load` distinct-values probe; cached per (workspace, game, dim); 50-row max; string equality ops only.

### Cube-segment sidecar scope chips

- **`cube-segment-scope-chips.tsx`** — Toggleable chips render model-defined cube segments in editor. Owner/admin-gated add affordance. Cross-cube entries read-only + always preserved. Server `PATCH /api/segments/:id` accepts `cube_segments` with precedence spec (tree+segments / segments-only / tree-only carry-forward), canonical sort, equality no-op guard.

### Definition deeplink segment → Playground

- **Deeplink builder** (`predicate-tree-to-cube-query.ts`) — Trees → Cube filters (preserving relative-date literals like `inDateRange(last 30 days)` + boolean AND/OR groups; identity dim + sidecar segments auto-attached). Replaces broken `?from-segment=` (uid-IN only, choked on >8k-char UIDs).
- **Playground boot** — `?edit-segment=<id>` + sessionStorage edit context (always persisted). Game-mismatch guard; dead `?from-segment=` path retired with consumer migrated (saved-analyses uid-IN overlay stays via new deeplink).

### Save-back from Playground to Segment Editor

- **Refining banner** — Playground shows "Refining: <segment-name>" when edit-context active.
- **SegmentsSaveBar update mode** — New "Update <name>" action (translatability gate blocks unexpressible constructs: empty-predicate guard, nested-group constructs, operators the reverse translator can't consume). Save-as-new always available. Injected echo filters (per-cube gameId scoping) stripped by exact structural match (`echo-filter-stripper.ts`).
- **Patch + auto-refresh** — PATCH → refresh enqueued immediately (same path as in-editor predicate edits) → navigate back. Conflicts: last-write-wins by design. Can_administer-gated.

### Code paths

- **Server:** `routes/segments.ts` (`withCubeSegments` + `cube_segments` PATCH precedence); `services/translator.ts` (tree → filters at save). Identity-map rows are data, not schema — no migration.
- **FE:** `src/pages/Segments/predicate-tree-to-cube-query.ts` (tree → boot query, relative literals preserved); `src/utils/playground-deeplink.ts` (definition deeplink + edit context); `src/QueryBuilderV2/segments-save-bar/` (translatability-gate, echo-filter-stripper, use-segment-update-action); `build-predicate-from-rows.ts:171` (query → tree, used by save-back).

---

## Member 360 Data-Coverage Surface (jus_vn enablement + per-game evaluator)

Per-game + per-panel live data-coverage status (ready/partial/empty/blocked) visible to admin + end-user (chip on Members tab when no 360). Replaces hand-audited spreadsheets with a queryable Cube YAML → Trino → product classifier.

### Services (server-side)

- **Coverage classifier** — `server/src/services/member360-coverage.ts`. Hybrid /meta-diff + 1-row probe evaluator: for each game/panel, query Cube `/meta` for dimension existence + /load a single row from that panel's view. Status enum: `ready` (meta + row), `partial` (meta but no row), `empty` (meta but all NULL), `blocked` (Cube error). Rollup: game `ready` iff all `corePanels` ready. Workspace-aware: game_id (full eval) vs prefix (flagged `prefixUnsupported` without detail).

### Routes (server-side)

- **`routes/workspaces.ts`** — `GET /api/workspaces/:id/member360-coverage` returns `{ ready: bool, games: [{ id, readyCount, totalCount, prefixUnsupported, panels: [{id, status, message}] }] }`. Per-workspace, per-game scoped; timeout-safe (LLM-style fallback for slow Cube).

### Frontend (admin UI at `/admin/dev/data-coverage`)

- **Data-coverage panel** — `dev-hub-panel.tsx` new sub-tabs (Chat-Audit | Data coverage). Per-game matrix: rows = panels, cols = game statuses (color-coded dots). Click dot → resolve pane: shows Trino column + Cube YAML + product context + cached error message.
- **Member360-coverage panel** (`member360-coverage-panel.tsx`) — table of `{ game, status, readyCount/totalCount, lastCheck }` + manual refresh button (cooldown respected server-side).

### Frontend (end-user UI on Members tab)

- **Unavailable chip** — `member360-unavailable-chip.tsx`: renders when segment's game has no Member 360 config; tooltip: "Member 360 not available for {game}. Contact the data team to enable."
- **Partial-coverage notice** — `member360-coverage-notice.tsx`: banner on the 360 page when game status is `partial`. Yellow background, lists missing panels + link to `/admin/dev/data-coverage`.

### jus_vn Enablement

- **Cube model** — New `cube-dev/cube/model/views/jus/user_360.yml` (4 core + 3 audience views). jus/jus_vn share ballistar's core-360 panel/section shape; config in `member360-panels.ts` + `member360-sections.ts`.
- **Parity guard** — Server test parity assertion extended to jus/jus_vn alongside cfm/ballistar (ensures coverage evaluator catches new game adds).

---

## VIP Care Playbook Console (21-playbook care ledger + CS monitor + authoring)

Stateful CS console for the VIP Care Program: a monitor grid (playbook status + case count), action queue, per-VIP care history, and a playbook builder for threshold/predicate overrides. Single source of truth is the `care_cases` ledger; availability gating + data-calibrated thresholds ensure only reachable VIPs qualify.

### Core Services (server-side)

- **Playbook registry** — `server/src/care/playbook-registry.ts`. Seeded 21-playbook config (per-playbook: condition predicate, watched metric, KPI, action, channel, priority, dataRequirements). One registry, rendered per-game with availability gating.
- **Threshold-rule compiler** — `server/src/care/threshold-rule.ts`. Compiles threshold rules (abs / tierStep / event / percentile / ratio) into Cube-queryable predicates (ANDed onto cohort predicate at finalization). Zod-validated ThresholdRule schema.
- **Availability resolver** — `server/src/care/availability.ts`. Per-game evaluator: checks Cube `/meta` for dataRequirements members; missing ⇒ status `unavailable` (greyed, no query). Scoped to game's prefix to prevent prod cross-game member leaks.
- **Playbook merge** — `server/src/care/playbook-merge.ts`. Merges seed configs ⊕ DB overrides (threshold tune, supplemental predicate, custom playbooks). One registry, N override versions per game.
- **Game-scope guard** — `server/src/care/game-scope.ts`. Allowlist + path-traversal guard for game-scoped routes.
- **Care-case store** — `server/src/care/care-case-store.ts`. CRUD on `care_cases` table (migration 037): case status, membership, trigger timestamp, notes, assignee, contact history.
- **Case engine** — `server/src/care/care-case-engine.ts`. Core logic: idempotent case open, membership diff (who's new/lapsed), trigger eval, by-VIP priority dedup, condition lapsed tracking.
- **Case sweep driver** — `server/src/care/care-case-sweep.ts`. Orchestrates refresh: calls Cube cohort fetcher (injected), runs trigger eval, returns new+updated cases. Unit-tested via injection (no live Cube required).
- **Care governance** — `server/src/care/care-governance-store.ts`. CRUD on `care_governance` table (migration 038): org-wide fatigue rules (max 1 proactive/VIP/24h, per-channel cooldown defaults).
- **Contact fatigue** — `server/src/care/fatigue.ts`. Window-based fatigue calc: checks last contact per channel, applies cooldowns (call 7d, Zalo 48h, in-game/push 24h), surfaces `cao`-priority cases hitting cap as "blocked — override?" (human decision).
- **KPI auto-eval** — `server/src/care/kpi-eval.ts`. Numeric-threshold-only: auto-resolves cases where the watched metric hits the KPI threshold. Idempotent job, never reverts.
- **Calibration CLI** — `server/src/care/calibrate.ts`. Runs on live Cube: reconciles registry logical member names against `/meta`, seeds concrete threshold values (percentile cutoff, personal-baseline ratio), writes back to registry.

### Routes (server-side)

All care routes in `PROTECTED_PREFIXES` — editor/admin write-gated, viewers read-only.

- **`GET /api/care/playbooks?game=<id>`** — 21 playbooks (seeded ⊕ overrides merged), per-game availability gated.
- **`GET /api/care/cases?game=&playbook=&status=&page&pageSize`** — By-Playbook lens. `playbook` and `status` accept comma-delimited lists (multi-select filters) or scalar (back-compat); empty filters = all. Paginated, enriched with `playbook_name`, `playbook_priority`, VIP profile snapshots. Response: `{cases, total, page, pageSize}`.
- **`GET /api/care/cases/by-vip?game=&q=&page&pageSize`** — By-VIP lens. Deduplicates open cases per VIP, ranked by top-priority playbook then case count. Optional `?q=` substring search (uid OR display name, filtered on full ranked set before pagination). Response: `{vips: [{uid, caseCount, topPriority, playbooks, profile}], total, page, pageSize}`.
- **`GET /api/care/cases/vip/:uid?game=`** — VIP's full case history (timeline), cross-playbook, enriched with playbook metadata.
- **`PATCH /api/care/cases/:id`** — case status, assignee, channel_used, action_taken, notes, outcome, kpi_eval_at, condition_lapsed.
- **`POST /api/care/cases/sweep?game=`** — on-demand sweep. Materializes current VIP cohort for each membership playbook against live Cube, opens/lapses cases. Editor/admin write-gated. Response: `{game, opened, lapsed, profilesRefreshed, summaries}` or 409 SWEEP_BUSY / 502 SWEEP_FAILED.
- **`GET /api/care/governance?game=`** — org fatigue rules (or defaults).
- **`PUT /api/care/governance`** — update fatigue rules (max outreach, cooldowns).
- **`GET /api/care/fatigue?game=&uid=&channel&priority`** — fatigue verdict for a proposed outreach.
- **`POST /api/care/playbooks`** — create custom playbook (threshold rule, supplemental predicate, enabled).
- **`PATCH /api/care/playbooks/:id`** — edit override (threshold, predicate, enable/disable).
- **`DELETE /api/care/playbooks/:id`** — delete custom playbook override (seeds immutable).
- **`GET /api/care/sweeps/runs?game=&limit`** — sweep run snapshots (for trend/diff picker).
- **`GET /api/care/sweeps/trend?game=&playbook=`** — cohort-size trend per playbook across runs.
- **`GET /api/care/sweeps/diff?game=&runA=&runB=`** — per-playbook count + membership deltas between runs.
- **`GET /api/care/sweeps/diff/vips?game=&runA=&runB=&playbook=&direction=&page&pageSize`** — paginated VIP drill (entered/left membership) between two runs, profile-enriched.

### Migrations

- **`036-care-playbooks.sql`** — `care_playbooks(id, seed_base_id, game_id, name, condition_predicate, data_requirements, threshold_rule, supplemental_predicate, enabled, created_at, updated_at)`. Seed rows immutable (NULL override rows). Override rows carry supplemental AND/OR predicate persisted at migration 039.
- **`037-care-cases.sql`** — `care_cases(id, game_id, vip_uid, playbook_id, status, membership_state, trigger_ts, condition_lapsed, assignee, contact_history, notes, created_at, updated_at)`. Idempotent case store keyed by (game, vip, playbook).
- **`038-care-governance.sql`** — `care_governance(workspace_id, max_proactive_per_vip_24h, call_cooldown_days, zalo_cooldown_hours, ingame_push_cooldown_hours, updated_at)`. One row per workspace.
- **`039-care-playbook-supplemental-predicate.sql`** — adds nullable `supplemental_predicate` column to override rows, ANDed onto compiled cohort predicate at finalization.

### Frontend

- **CS Monitor** — `src/pages/Dashboards/cs/index.tsx`. Grid of 21 playbooks: seed name, status (available/unavailable), active case count, case rate, last trigger. Header: "+ New playbook" CTA, game selector, refresh. Reuses grid + card patterns from Dashboards.
- **By-Playbook lens** — `src/pages/Dashboards/cs/cases/index.tsx`. Case Ledger with multi-select playbook filter (`src/pages/Dashboards/cs/playbook-filter-bar.tsx`) + de-emphasized status chip row (`status-chip-row.tsx`). URL is source of truth (`?playbook=01,04&status=new,treated`); empty playbook selection = all. "Matched Playbook" pill links to that playbook's queue. Paginated case grid.
- **By-VIP lens** — `src/pages/Dashboards/cs/by-vip/index.tsx`. Debounced uid/name search (`?q=`) filters the ranked VIP queue. Server-enriched with profile snapshots (SQLite, no live Cube). Click case or VIP → detail drawer.
- **Action Queue** — `src/pages/Dashboards/cs/queue/index.tsx`. Paginated, sortable case list (VIP name, playbook, status, assignee, fatigue window, contact history). Click case → detail drawer. Assignee pull-pool + affinity support (route to known AM if set).
- **Playbook Builder** — `src/pages/Dashboards/cs/playbooks/new.tsx` + `/:id/edit.tsx`. Four-section form: playbook name/description, threshold rule (rule-type picker + value input), supplemental predicate (optional AND/OR using Segments builder), enable/disable toggle. Read-only for viewers. Mutation id-routing via `playbook-mutation-target.ts` (seed→POST base_id, override→PATCH override-row-id).
- **Sweeps snapshot comparison** — `src/pages/Dashboards/cs/sweeps/index.tsx`. Compare cohort size trends + membership deltas (entered/left) between two sweep runs. Run picker + per-playbook trend chart + drill detail (VIP list with profiles) via `GET /api/care/sweeps/*`.
- **Member-360 Care tab** — `src/pages/Segments/member360/care-tab.tsx`. Segment-less care branch. Case timeline (dates, playbooks triggered), governance status (fatigue window, blocked-override flag), contact history, action affordances (update status, assign, log contact). Reuses reference panels from Segments 360.
- **API client** — `src/api/care-playbooks-client.ts`. Typed CRUD + case routes (filters, by-vip search, sweeps).

### Tests

- **Server:** `care-playbook-registry.test.ts`, `care-playbooks-route.test.ts`, `care-case-ledger.test.ts`, `care-case-sweep.test.ts`, `care-cases-route.test.ts`, `care-playbooks-authoring.test.ts` (54 tests, 36 from initial phases, 18 from Phase 6 authoring close-out).
- **Frontend:** `cs-monitor.test.ts`, `cs-queue.test.ts`, `playbook-builder.test.ts`, `playbook-mutation-target.test.ts`, `care-tab.test.ts` (55 tests).

### Deferred to Live Integration

- **Cron scheduling + live trigger eval.** `runCaseSweep` + `makeCubeCohortFetcher` are implemented and unit-tested via injection. Only the background scheduler tick + HTTP POST trigger remain (need reachable Cube workspace to fetch cohorts).
- **Live threshold calibration.** The `calibrate.ts` CLI (runs on host dev / prod-mirror) reconciles registry logical member names (e.g., `mf_users.ltv_total_vnd`, `user_recharge_daily.revenue_vnd`) against live `/meta` and seeds concrete values. Starter percentile estimates in spec carry forward until live calibration runs.
- **Percentile-rule cutoff computation.** Threshold-rule engine supports percentile rules; currently no seed uses percentile. Awaiting live data probe to determine the cutoff value.

---

## Query Performance & Optimization Hub (2026-06-16)

Admin-only Cube query telemetry surface + optimization-suggestion engine. Captures gateway `/load` handler latency, status, and rollup routing (query-perf table, 30d retention via background prune job). Admin triage UI at `/admin/query-perf` lets operators drill failed/slow queries, view optimization recommendations (deterministic playbook-matching + optional LLM-driven suggestions), and scaffold pre-aggregation YAML drafts.

### Services (server-side)

- **Query perf capture** — `server/src/services/query-perf-store.ts`. Fire-and-forget log to `query_perf` SQLite table (migration 061): 200-sampling (captures all non-200, 1-in-5 of 200s), 30d retention. Populated from `/load` handler in `cube-proxy.ts` with latency timing. **`query_shape`** is the names-only projection (`projectQueryShape`) used by the classifier/summary; **`query_full`** (migration 062) additionally stores the VERBATIM query — filter values, dateRange, any UID list — a deliberate **admin-only** posture so an operator can reproduce the exact slow/failed query (exposure bounded by admin-only routes + 30d prune; the `activity_events` spine stays names-only). **`source`** captures which app surface issued the query via an explicit `x-cube-source` header the client sets (machine strings: `query-builder`, `dashboard:<id>`, `segment:<id>[:<tab>]`, `catalog…`, `chat:<sessionId>`) — derived from the live SPA route in `src/api/cube-query-source.ts` and injected by both transports (apiFetch `buildRequestHeaders` + the Cube SDK `useCubejsApi`); chat-service tags its calls in `load-cube-rows.ts`. The proxy prefers the header, falls back to Referer, else null → "API / server". Not PII (app routes/ids). The admin UI shows it as a **"Used in"** column + humanizes it (`humanizeCubeSource`).
- **Query perf classifier** — `server/src/services/query-perf-classifier.ts`. Read-time tri-state verdict: pre-agg-hit status (yes / no / unknown), rollup matchability (matchable / not-matchable / unmatchable-by-design), human-readable reason. Evaluates `usedPreAggregations` against per-game registry view (Cube /meta structure).
- **Optimization playbooks** — `server/src/services/optimization-playbooks.ts`. 5 seed remedies, each a pure `appliesWhen(verdict)` predicate: `materialize-snapshot` (per-user listing — unmatchable), `add-rollup` (matchable miss; scaffolds YAML), `remodel-non-additive`, `narrow-time-grain`, `accept-or-raise-timeout` (universal fallback). `optimization-playbook-matcher.ts` is pure/deterministic; `needsLlm` is true only when the sole match is the generic fallback (the LLM gate).
- **Rollup YAML scaffolder** — `server/src/services/rollup-yaml-scaffolder.ts`. Pure draft generation from the query shape: additive-only measures, identity dims dropped (with warnings), time_dimension copied from the query's bound dim, `build_range_end` LEAST cap for timestamp time-dims. Returns a string to copy — no file write, no Cube call, no auto-apply.
- **LLM suggester** — `server/src/services/query-perf-llm-suggester.ts`. On-demand only (never auto-runs on capture); per-id in-memory cache + per-admin token-bucket rate-limit (default 5/min) + hard timeout (default 60s); sonnet-pinned LiteLLM gateway one-shot. NAMES-only prompt. Returns `{suggestion, lane}` or `{error}` (never throws). Playbook match is always available regardless.

### Routes (server-side)

- **`GET /api/query-perf/failures`** — non-200 queries (failure triage). Params: `?since` (epoch-ms), `?limit` (capped 100). Newest-first. Response: `{rows: [{id, ts, actorEmail, workspace, game, method, status, latencyMs, usedPreaggs, preaggHit, matchability, reason, shape, errorExcerpt}]}`. Admin-gated.
- **`GET /api/query-perf/recent`** — 200-status queries (success list, default closed). Params: `?since`, `?limit`.
- **`GET /api/query-perf/summary`** — KPI rollups (total count, failures, slow count, Trino fallthrough, p50/p95 latency, slow threshold). Params: `?since`. Response: `{total, failures, slow, fallthrough, p50LatencyMs, p95LatencyMs, slowMs}`.
- **`GET /api/query-perf/:id/suggestion`** — Deterministic classifier→playbook match (NO LLM). Response: `{verdict: {preaggHit, matchability, reason}, playbooks: [{id, title, rationale, steps, scaffolds}], best, needsLlm}`. 404 if row gone.
- **`GET /api/query-perf/:id/scaffold`** — Pure draft pre-agg YAML. Response: `{yaml: string|null, warnings: [], verdict}` (yaml null when the shape is unmatchable). 404 / 422 (no shape).
- **`POST /api/query-perf/:id/llm-suggest`** — On-demand LLM remedy, gated on `needsLlm`. Returns `{suggestion, lane}` or `{error}` (200, non-blocking). **409** when a playbook already fits (LLM reserved for the genuine gap). Per-admin rate-limit + per-id cache + hard timeout.

### Jobs

- **Prune query-perf** — `server/src/jobs/prune-query-perf.ts`. Daily, deletes rows older than 30 days. Logs count.

### Migrations

- **061-query-perf.sql** — `query_perf` table (`id, ts, actorEmail, workspace, game, method, status, latencyMs, shape, usedPreaggs, errorExcerpt`). Index on `(workspace, game, ts)`.

### Frontend (Admin Hub)

- **Query Performance tab** — `src/pages/Admin/hub/query-perf-tab.tsx`. KPI strip (total, failures, p95 latency, Trino fallthrough, slow count) + Failures table (triage, newest-first) + collapsible Successful queries section (lazy-fetched). Table columns: timestamp, actor, game, status, latency, pre-agg verdict (tri-state), matchability. Row-click opens detail panel.
- **Optimize panel** — `src/pages/Admin/hub/query-perf-optimize-panel.tsx`. Right-docked master-detail: query shape (YAML), used-preggs list, error excerpt (if failed), "Suggestion" card (playbook + LLM options), "Scaffold pre-agg" card (YAML preview, copy-able). Actions: "Load suggestion", "Live LLM suggest", "Copy YAML".
- **Data client** — `src/pages/Admin/hub/query-perf-data.ts` (typed hooks: `useQueryPerfSummary`, `useQueryPerfFailures`, `useQueryPerfRecent`).

---

## Segment Metric-Movement Lakehouse (2026-06-12, extended 2026-06-18)

Per-segment-cadence snapshot of segment definitions + membership deltas + per-user state + KPI time-series into Trino Iceberg (`stag_iceberg.khoitn`), powering cohort trajectory, metric series, and movement analytics.

### Lakehouse Tables (Trino Iceberg, 15m-cadence writes with snapshot_ts)

- **`segment_definition_daily`** — segment metadata (id, name, type, cube_name, predicate JSON, definition_hash, identity_dimension, **snapshot_ts**). Writer: `server/src/lakehouse/segment-definition-writer.ts`. Cardinality: ~10–100 per game per day.
- **`segment_membership_daily` / `segment_membership_delta`** — membership (user_id, segment_id, **snapshot_ts**) + delta (entered/exited per snapshot). Now threaded with `snapshot_ts` (per-segment-cadence).
- **`segment_member_state_daily`** (2026-06-18) — per-user mf_users canonical state: (snapshot_ts, segment_id, uid, ingame_name, ltv_vnd, ltv_30d_vnd, is_paying_user, is_paying_30d, total_active_days, days_since_last_active, …). Schema from `CANONICAL_USER_STATE_COLUMNS`. One row per (snapshot_ts, segment, uid). Columns absent from a game's /meta → NULL. Writer: `server/src/lakehouse/segment-member-state-writer.ts` (predicate-free mf_users projection via Cube `/sql`, cached per game+ts; JOINed in Trino to membership@snapshot_ts).
- **`segment_kpi_daily`** (2026-06-18) — segment-level KPI time-series: (snapshot_ts, segment_id, metric, value DOUBLE NULL, member_count BIGINT). Values from `runScopedKpi` (card-runner, same path as Insights tab); non-additive measures correct (paying_rate_30d, arppu_vnd, whales_count). Empty cohort → NULL. Writer: `server/src/lakehouse/segment-kpi-writer.ts` (idempotent DELETE+INSERT per game/segment/snapshot_ts slice).

### Services (server-side)

- **Definition writer** — `server/src/lakehouse/segment-definition-writer.ts`. Idempotent: deletes old partition, INSERT-SELECTs current segment definitions (from SQLite) + cube metadata joins to produce normalized rows. Never throws; failure logs WARN. Wired into `server/src/jobs/snapshot-segment-membership.ts` with `__definitions__` heartbeat sentinel.
- **Trajectory reader** — `server/src/lakehouse/segment-trajectory-reader.ts`. Joins membership snapshots + identity map to materialize per-(segment, day) cohort size + daily entered/exited flow (closed cohort, fixed-anchor per segment).
- **Member-state writer** — `server/src/lakehouse/segment-member-state-writer.ts`. Compiles predicate-free mf_users projection via Cube `/sql` (cached per game+snapshot_ts); JOINs in Trino to membership@snapshot_ts to scope rows to segment members. Uses `physicalMember` resolver to drop columns absent from game's /meta. Never throws; logs WARN on 0-row JOINs (dead-join signal).
- **KPI writer** — `server/src/lakehouse/segment-kpi-writer.ts`. Calls `runScopedKpi` per metric in `segmentKpiSpecsForPreset` (Insights-tab path, same value guarantees). Empty cohort → NULL value. Idempotent per (game, segment, snapshot_ts).
- **Metric-series registry** — `server/src/lakehouse/segment-metric-registry.ts`. Seeded probe-verified (game, mart) pairs (cfm_vn + jus_vn: revenue, active_members). Per-mart pre-registration prevents wild data-warehouse scans.
- **Metric-series reader** — `server/src/lakehouse/segment-metric-series-reader.ts`. Joins membership snapshots to per-user daily marts at query time, three cohort lenses: (a) **current** (membership@d ⨝ fact@d), (b) **entry** (closed cohort, per-member clock from first entry day, tracked through marts even after exit), (c) **stayers** (membership@anchor ∩ membership@d, survivor-bias flag). Dead-join detection: warns ≥5 all-zero cohort days.
- **Movement reader** — `server/src/lakehouse/segment-movement-reader.ts`. Reads state/KPI snapshots from lakehouse; routes (kpi-trend, movement, state-distribution, state-distribution-trend). Server-side downsampling via `downsample-snapshots.ts` (last-in-bucket, never sum). Redaction parity with members API: strips sensitive columns (ltv_*, is_paying_*) from unauthenticated callers.
- **Snapshot downsampler** — `server/src/lakehouse/downsample-snapshots.ts`. Bins snapshots by requested granularity (coarser than captured); aggregates by last-in-bucket (never sum — snapshots are as-of values). Mixed-cadence windows collapse to coarser; finer than captured → carry-forward. Effective_granularity + cadence-change detection in response header.
- **Canonical metric set** — `server/src/lakehouse/canonical-metric-set.ts`. Single source of truth: `CANONICAL_USER_STATE_COLUMNS` (schema, positional order) + `segmentKpiSpecsForPreset` (KPI list from preset registry). State-writer schema DDL + INSERT iterates the same array, so positional drift is impossible.

### Routes (server-side)

- **`GET /api/segments/:id/trajectory`** — cohort size + entered/exited series from membership snapshots. guardSegment auth, 1h TTL bounded cache, 502 LAKEHOUSE_UNAVAILABLE on outage, 404 for non-predicate/no-game segments. Response: `{trajectory: [{day, size, entered, exited}]}`.
- **`GET /api/segments/:id/metric-series?metric=<name>&lens=<current|entry|stayers>`** — per-(segment, day) metric series joining membership to daily marts. Three cohort lenses (current/entry/stayers), registry-gated. Response: `{series: [{day, value, memberCount}], cohortType, registry?}`.
- **`GET /api/segments/:id/eligible-metrics`** — which metrics are queryable for this segment (registry-gated per game + mart availability). Response: `{metrics: [{id, name, display_name}]}`.
- **`GET /api/segment-refresh/snapshot-runs`** — admin observability: per-instance heartbeat + cross-instance Trino latest-partition truth. 10-min TTL. Response: `{runs: [{instance, status, lastRunAt, definitionsPartition, membershipPartition}]}`.
- **`GET /api/segments/:id/movement/kpi-trend?start=<date>&end=<date>&granularity=<cadence>`** (2026-06-18) — KPI time-series per metric from segment_kpi_daily. Server-side downsampling. Tokenless, serve-stale on Trino error. Response: `{series: [{snapshot_ts, metric, value}], effective_granularity, cadence_changes?}`.
- **`GET /api/segments/:id/movement/series?start=<date>&end=<date>`** (2026-06-18) — member entry/exit series from state snapshots. Tokenless, serve-stale. Response: `{events: [{snapshot_ts, entered_count, exited_count}]}`.
- **`GET /api/segments/:id/movement/state-distribution?snapshot_ts=<ts>&dimension=<key>`** (2026-06-18) — histogram of a state dimension (ltv_vnd, is_paying_user, …) at a snapshot. Redaction-gated (sensitive columns hidden from unauthenticated callers). Response: `{distribution: [{bucket, count}]}`.
- **`GET /api/segments/:id/movement/state-distribution-trend?start=<date>&end=<date>&dimension=<key>&granularity=<cadence>`** (2026-06-18) — histogram trend over time. Server-side downsampling. Redaction-gated. Response: `{trend: [{snapshot_ts, distribution: [{bucket, count}]}], effective_granularity, cadence_changes?}`.

### Frontend

- **Trajectory card** — `src/pages/Segments/detail/cards/trajectory-card.tsx` + `-model.ts`. Stat rail (size now, entered 7d, exited 7d) + sparkline (30d size trend) + diverging entered/exited strip (no interpolation on gaps, amber markers). Live data refresh on segment refresh.
- **Metric-movement card** — `src/pages/Segments/detail/cards/metric-movement-card.tsx`. Lens tabs (current / entry / stayers) with semantic blurbs, survivor-bias and dead-join warning banners.
- **Snapshot-runs admin card** — `src/pages/Admin/hub/snapshot-runs-section.tsx`. Segment-refresh ops tab; per-instance status + Delta/Definitions columns, latest-partition truth from Trino.

### Scripts (server-side)

- `server/src/scripts/verify-lakehouse-snapshot-partitions.ts` — audit tool; checks Trino partition alignment.
- `server/src/scripts/verify-segment-definition-snapshot-live.ts` — live definition snapshot validation.
- `server/src/scripts/run-segment-membership-snapshot-once.ts` — manual on-demand trigger.
- `server/src/scripts/verify-entry-lens-post-entry-live.ts` — entry-lens post-entry tracking validation.

### Operational Notes

- **15-minute job tick (2026-06-18).** Job `snapshot-segment-membership.ts` runs every 15m; per-segment elapsed-check decides if the current cadence bucket is due. Only opted-in segments run sub-daily; default-daily preserves legacy once-per-day. Guard: per-(segment, snapshot_ts) in `segment_snapshot_log.snapshot_ts` prevents double-writes across restarts. All time math GMT+7.
- **Smoke test before prod deploy:** State writer parses Cube `/sql` alias format offline (expects `cube__field`). If Cube alias format drifts, INSERT lands zero rows silently. Before shipping, run the writer on a live segment + `SELECT COUNT(*) FROM segment_member_state_daily` — must be > 0.
- **Nightly write dormant in prod.** `SEGMENT_SNAPSHOT_ENABLED` is unset in prod Vault as of 2026-06-12. Manual partition runs via scripts; automatic scheduling deferred pending live validation.
- **Local development.** Queries succeed against local/mock partitions if Trino is reachable; lakehouse is read-only on dev instances. Never set `SEGMENT_SNAPSHOT_ENABLED=true` on dev machines — writes double-scan shared Trino (per-instance guard is local SQLite).
- **Availability gate.** Metric-series routes return 404 if segment has no game or predicate (not queryable); registry gates per-game (cfm_vn/jus_vn only, other games return empty metrics list). Movement endpoints are tokenless + serve-stale, no registry gate.

---

---

## CS Ticket Care History 360 (2026-06-13)

NEW per-member CS transcript page + row-expand on Care tab watchlist. Routes `/segments/:id/members/:uid/care` (Inbox ↔ Timeline toggle) + inline ticket-summary cards. Guards segment membership + CS-game availability. Deep lakehouse reader: ticket_communications_centralized (timestamps÷1000 before from_unixtime), cs_ticket_map_ai_label, ticket_ratings_centralized, tickets_v2 (login_info legitimacy + account/security label pattern), cs_map_status, customers_v2 (VIP). Signals: securityFlag, firstResponseLatencyMin, sentimentTrajectory, reopenCount, htmlSnippet. Reuses cs-ticket-reader helpers + cs-recharge-trajectory.

### Services (server-side)

- **CS ticket detail types** — `server/src/lakehouse/cs-ticket-detail-types.ts`. Schema: CsTicketDetail (ticket id, subject, category, status, created/updated, communication count, rating, sentiment, securityFlag), CsTicketCommunication (timestamp, direction, author, text), CsTicketRating (timestamp, rating, feedback). Derived signals enum.
- **CS ticket detail reader** — `server/src/lakehouse/cs-ticket-detail-reader.ts`. Resolves Trino connector via `resolveCsTrinoConnector()`; per-(segmentId, uid) queries iceberg.cs_ticket + join layers; dedupes multi-row (ROW_NUMBER); groups by category/sentiment/rating; caps and LOOKBACK_DAYS filter. Returns ordered list of CsTicketDetail[] with full communication + rating history.
- **CS ticket detail signals** — `server/src/lakehouse/cs-ticket-detail-signals.ts`. Derives securityFlag (login_info≠uid AND account/security label), firstResponseLatencyMin, sentimentTrajectory, reopenCount, htmlSnippet. Pure functions testable without lakehouse.

### Routes (server-side)

- **`GET /api/segments/:id/members/:uid/cs-tickets`** — guardSegment(read) + uid∈uid_list_json (404 NOT_IN_SEGMENT); predicate+CS-game gate. Payload: segmentId, gameId, uid, member{name,ltv}, coverage{joined,note}, freshness{csMaxLogDate}, recharge{windowDays}|null, tickets[]. Caps: 60 tickets, 80 messages/ticket, 10 ratings/ticket, 365d lookback. 6h TTL. CS-fail→502, recharge-fail→null.

### Frontend

- **Member-360 care-history-360/** — `src/pages/Segments/member360/care-history-360/`. Entry: `/segments/:id/members/:uid/care`. Inbox view (3-pane: ticket list, detail, communication thread), Timeline view (chronological). Drilled from Care tab watchlist row-expand (lazy-loaded ticket summary cards). Inbox/Timeline toggle persistent (localStorage). Status + sentiment semantic colors, HTML snippet inline preview.
- **Care tab watchlist row-expand** — `src/pages/Segments/detail/tabs/care-tab.tsx` rows now expand inline to show ticket summary cards (date, subject, status, latest communication preview). "View all" → navigate to `/care` page.
- **Client** — `src/api/segment-cs-care-member.ts` (typed GET call, keyed by segmentId+uid).

---

## CS Demo-Care Loop (Persisted Actions, KPI Outcome, Activity, Reseed)

Makes the CS console a true interactive demo loop: real ledger-driven timelines, persistent treatment/claim/dismiss actions, human-closed KPI outcome tracking, case export, rolling activity metrics, and guarded reseed capability. All routes leverage existing `/api/care/cases/:id` PATCH infrastructure + new activity + reset endpoints.

### Frontend Modules

- **Member-360 timeline derive** — `src/pages/Dashboards/cs/member360/cs-member360-derive.ts`. Pure transforms (testable without React): `caseToTimelineEvent()` (maps ledger case status → timeline event with optional outcome badge), `topOpenCaseAsRecommendedAction()` (derives talk-track from playbook + top case). Reuses `CareTimelineEvent` and `RecommendedAction` types from mock.
- **Treatment actions** — `src/pages/Dashboards/cs/cs-case-actions.ts`. Async helpers: `claimCareCase()`, `dismissCareCase()` (reason code), `treatCareCase()` (channel/action/notes), `closeCaseWithOutcome()` (KPI met/missed). Each wraps `patchCareCase()` from `use-care-cases.ts:336`. DRY pattern for multi-phase workflows.
- **Member-360 treatment form** — `src/pages/Dashboards/cs/member360/cs-action-rail-forms.tsx`. Inline treat form (channel select, action textarea, notes). Submit gated on `canWrite`, shows pending + error state. Powered by `treatCareCase()`.
- **Case ownership inline edit** — `src/pages/Dashboards/cs/cs-owner-chip.tsx`. Claim-to-me button + assignee dropdown. Updates assignee field via PATCH. Click-to-edit affordance.
- **Dismiss with reason** — `src/pages/Dashboards/cs/cs-case-actions.ts`. Reason code picked from UI (too many, spam, resolved, etc.) → encoded in dismiss endpoint call. Status + notes stamped server-side.
- **KPI outcome badge** — Reuses `OutcomeChip` from `cs-care-history-timeline.tsx:49`. Resolved rows render `kpi_met ✓ / missed ✗` badge (semantic colors).
- **Close with outcome buttons** — `cs-recommended-action-rail.tsx` + queue treated rows. Two CTA: "Close · KPI met" / "Close · KPI missed" → `closeCaseWithOutcome()` → refetch.
- **Portfolio KPI-met rate** — `use-care-playbooks.ts:160-186` extended. New additive field `kpiMetRate = kpi_met / closed-with-outcome`. Existing `attainmentRate` untouched. `portfolio-strip.tsx` renders new "KPI met %" card alongside attainment.
- **Case export to CSV** — `src/pages/Dashboards/cs/care-queue-csv.ts`. Util `exportQueueToCSV()` (cases array → CSV download link). Columns: VIP UID, playbook, status, outcome, channel_used, action_taken, treated_at, closed_at, notes. "Export queue" link on Monitor.
- **Activity strip** — `src/pages/Dashboards/cs/cs-activity-strip.tsx`. Renders rolling 24h metrics (treated/dismissed/resolved counts) + recent events list. Fetched from new `/api/care/activity?game=` route. Positioned left sidebar on Monitor. GMT+7 timestamps.

### Server Routes & Store

- **`GET /api/care/activity?game=<id>`** (new) — Rolling 24-hour aggregate for game: treated/dismissed/resolved counts per hour, recent events (case id, vip uid, playbook, action type, timestamp, actor email). Scoped SQLite query on care_cases + activity_events. Response: `{game, hours: [{ts, treated, dismissed, resolved}], events: [{id, uid, playbook, action, ts, actor}]}`. Viewer-gated read (no special write role).
- **`POST /api/care/cases/reset?game=<id>[&resweep=true]`** (new) — Guarded full-game reseed. Delete all cases for a game (single transaction). Pre-check: `isSweepInFlight` → 409 if sweep running. Optional `?resweep=true` checkbox (OFF by default) to re-trigger sweep after delete. Confirm dialog in UI names game + count before delete. Editor/admin write-gated. Response: `{game, deletedCount, resweepTriggered}` or error.
- **`clearCases(gameId, workspaceId)`** (new) — `server/src/care/care-case-store.ts`. Single transaction: `DELETE FROM care_cases WHERE game_id = ? AND workspace_id = ?`. Returns count. Game + workspace scoped (no cross-game wipe risk).

### Migrations

No new migrations (existing columns: `status`, `assignee`, `channel_used`, `action_taken`, `notes`, `outcome`, `treated_at`, `closed_at` already exist on `care_cases` from prior phases).

### Tests

- **FE:** `cs-member360-derive.test.ts` (timeline derive + recommended action), `cs-case-actions.test.ts` (claim/dismiss/treat/close helpers), `portfolio-kpi-met-rate.test.ts` (KPI-met rate + attainment unchanged). Coverage of all UI state (pending, error, success).
- **Server:** care-activity-route test (aggregate logic), care-cases-reset test (transaction + resweep logic, mock isSweepInFlight).

### Constraints & Guarantees

- **Attainment semantics unchanged.** `attainmentRate = (treated + resolved) / total` remains the single ROI metric. New `kpiMetRate` is additive tracking only.
- **Outcome exclusive to human close.** Only humans select outcome (met/missed); `runKpiEval()` not wired this round (deferred to live when auto-eval is ready).
- **Re-sweep optional, OFF by default.** Reset deletes only; `?resweep=true` is a checkbox offer, not automatic. Permits demo to restart from blank slate without re-fetching Cube cohorts (which may be slow or absent locally).
- **Phase 4 — cfm_vn gameplay-daily mart** (data-team dependency). When live, 6 NHÓM-2 playbooks flip `unavailable → available` with zero frontend change (availability gating auto-detects new Cube members).
