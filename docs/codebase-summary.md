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
- **GamePicker**: Sits in Topbar's `fixedTrailing` prop (not via context) so it cannot be overwritten by per-page registrations.
- **App.tsx refactor**: `SmartSearchProvider > TopbarTrailingProvider > shell-flex(Sidebar + main(Topbar + scroll children))`. Routes: `/` → `/build` redirect, `/chat` → `ChatPlaceholderPage`, `/catalog` (exact) → `/catalog/data-model` redirect.
- **Header.tsx deprecation**: Kept on disk one release for safety; App.tsx no longer renders it (tests-only). Delete after next release.
- **Catalog IA (2026-05-23)**: Advanced sidebar section removed; Data Model & Metrics Catalog now distinct pages. Data Model subtabs (Schema / Concepts / Cubes / Models / Concept Map) at `/catalog/data-model{,/concepts,/cubes,/models,/concept-map}`, legacy routes 301-redirect. NotificationBell moved to Topbar (between SearchTrigger & AvatarMenu). Sidebar "New data model" label drops leading `+`. RecentItemPusher: concept-detail routes push to `data-model` module; business-metric detail to `metrics-catalog`. `catalog-tabs.tsx` refactored → `DataModelSubtabs` + `resolveDataModelSubtab`.

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
- **`GET /api/care/cases`** — open cases, paginated, sortable by priority/fatigue.
- **`GET /api/care/cases/by-vip`** — deduplicated case count per VIP.
- **`GET /api/care/cases/vip/:uid`** — VIP's full case history (timeline).
- **`PATCH /api/care/cases/:id`** — case status, assignee, notes, contact history.
- **`GET /api/care/governance`** — org fatigue rules.
- **`PUT /api/care/governance`** — update fatigue rules (max outreach, cooldowns).
- **`GET /api/care/fatigue`** — fatigue window + per-channel cooldown snapshot.
- **`POST /api/care/playbooks`** — create custom playbook (threshold rule, supplemental predicate, enabled).
- **`PATCH /api/care/playbooks/:id`** — edit override (threshold, predicate, enable/disable).
- **`DELETE /api/care/playbooks/:id`** — delete custom playbook override (seeds immutable).

### Migrations

- **`036-care-playbooks.sql`** — `care_playbooks(id, seed_base_id, game_id, name, condition_predicate, data_requirements, threshold_rule, supplemental_predicate, enabled, created_at, updated_at)`. Seed rows immutable (NULL override rows). Override rows carry supplemental AND/OR predicate persisted at migration 039.
- **`037-care-cases.sql`** — `care_cases(id, game_id, vip_uid, playbook_id, status, membership_state, trigger_ts, condition_lapsed, assignee, contact_history, notes, created_at, updated_at)`. Idempotent case store keyed by (game, vip, playbook).
- **`038-care-governance.sql`** — `care_governance(workspace_id, max_proactive_per_vip_24h, call_cooldown_days, zalo_cooldown_hours, ingame_push_cooldown_hours, updated_at)`. One row per workspace.
- **`039-care-playbook-supplemental-predicate.sql`** — adds nullable `supplemental_predicate` column to override rows, ANDed onto compiled cohort predicate at finalization.

### Frontend

- **CS Monitor** — `src/pages/Dashboards/cs/index.tsx`. Grid of 21 playbooks: seed name, status (available/unavailable), active case count, case rate, last trigger. Header: "+ New playbook" CTA, game selector, refresh. Reuses grid + card patterns from Dashboards.
- **Action Queue** — `src/pages/Dashboards/cs/queue/index.tsx`. Paginated, sortable case list (VIP name, playbook, status, assignee, fatigue window, contact history). Click case → detail drawer. Assignee pull-pool + affinity support (route to known AM if set).
- **Playbook Builder** — `src/pages/Dashboards/cs/playbooks/new.tsx` + `/:id/edit.tsx`. Four-section form: playbook name/description, threshold rule (rule-type picker + value input), supplemental predicate (optional AND/OR using Segments builder), enable/disable toggle. Read-only for viewers. Mutation id-routing via `playbook-mutation-target.ts` (seed→POST base_id, override→PATCH override-row-id).
- **Member-360 Care tab** — `src/pages/Segments/member360/care-tab.tsx`. Opens auto on VIP qualification. Case timeline (dates, playbooks triggered, contact history), governance status (fatigue window, blocked-override flag), action affordances.
- **API client** — `src/api/care-playbooks-client.ts`. Typed CRUD + case routes.

### Tests

- **Server:** `care-playbook-registry.test.ts`, `care-playbooks-route.test.ts`, `care-case-ledger.test.ts`, `care-case-sweep.test.ts`, `care-cases-route.test.ts`, `care-playbooks-authoring.test.ts` (54 tests, 36 from initial phases, 18 from Phase 6 authoring close-out).
- **Frontend:** `cs-monitor.test.ts`, `cs-queue.test.ts`, `playbook-builder.test.ts`, `playbook-mutation-target.test.ts`, `care-tab.test.ts` (55 tests).

### Deferred to Live Integration

- **Cron scheduling + live trigger eval.** `runCaseSweep` + `makeCubeCohortFetcher` are implemented and unit-tested via injection. Only the background scheduler tick + HTTP POST trigger remain (need reachable Cube workspace to fetch cohorts).
- **Live threshold calibration.** The `calibrate.ts` CLI (runs on host dev / prod-mirror) reconciles registry logical member names (e.g., `mf_users.ltv_total_vnd`, `user_recharge_daily.revenue_vnd`) against live `/meta` and seeds concrete values. Starter percentile estimates in spec carry forward until live calibration runs.
- **Percentile-rule cutoff computation.** Threshold-rule engine supports percentile rules; currently no seed uses percentile. Awaiting live data probe to determine the cutoff value.
- **Phase 4 — cfm_vn gameplay-daily mart** (data-team dependency). When live, 6 NHÓM-2 playbooks flip `unavailable → available` with zero frontend change (availability gating auto-detects new Cube members).
