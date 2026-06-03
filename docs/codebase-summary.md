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
- **Catalog IA (2026-05-23)**: Advanced sidebar section removed; Data Model & Metrics Catalog now distinct pages. Data Model subtabs (Concepts / Cubes / Models) at `/catalog/data-model{/cubes,/models}`, legacy routes 301-redirect. NotificationBell moved to Topbar (between SearchTrigger & AvatarMenu). Sidebar "New data model" label drops leading `+`. RecentItemPusher: concept-detail routes push to `data-model` module; business-metric detail to `metrics-catalog`. `catalog-tabs.tsx` refactored → `DataModelSubtabs` + `resolveDataModelSubtab`.

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
