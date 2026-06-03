# System Architecture

Core architectural patterns and data flows across cube-playground. Updated as major systems ship.

The first section is the **top-level overview** — the runtime tiers and how they talk. Everything after it documents a single feature subsystem in depth. For a file-by-file map of where code lives, see [`codebase-summary.md`](./codebase-summary.md); this doc owns runtime topology and request flows, that one owns the file layout.

## System Overview

cube-playground is a thin React SPA in front of a **Cube semantic layer**, with a Fastify **gateway server** that owns persistence + auth + proxying, and a separate **chat-service** that turns natural language into Cube queries. Four runtime tiers:

| Tier | Process | Port (dev) | Owns |
|---|---|---|---|
| **SPA** | Vite / React / TS | `:3000` | UI, query builder, dashboards, chat panel. Talks only to the gateway (`/api`, `/cube-api`) and — in dev only — direct Cube (`/cubejs-api`). |
| **Gateway server** | Fastify + better-sqlite3 | `:3004` | API gateway + system of record. Persists segments / analyses / identity-map / presets / dashboards / glossary / onboarding drafts. Proxies Cube (workspace-aware) and chat-service (creds-injecting). Mints Cube tokens. RBAC enforcement. `server/src/index.ts`. |
| **chat-service** | Fastify + SQLite | `:3005` | NL→Cube-query, disambiguation memory, session store, per-turn streaming registry. **Not reachable from the browser** — only via the gateway proxy. `chat-service/src/index.ts`. |
| **Cube (cube-dev)** | external semantic layer | `:4000` local / `:16000` prod-mirror | Compiles YAML models → SQL, executes `/meta` `/load` `/sql`. Lives in the sibling `cube-dev` repo, selected per workspace. `workspaces.config.json`. |

Auth/identity: pretend-auth `X-Owner` header in dev; Keycloak realm (`keycloak/realm-export.json`) backs `editor`/`admin` roles used for write-gating and workspace access.

### Topology

```
                         Browser (SPA)
                              │
          ┌───────────────────┼─────────────────────────┐
          │ /api, /cube-api    │ /cubejs-api, /playground  (dev only,
          ▼ (proxied)          ▼  direct-to-Cube)
   ┌──────────────────┐        │
   │  Gateway server  │        │
   │  Fastify  :3004  │        │
   │  ───────────────  │        │
   │  • SQLite (segments, dashboards,   │
   │    presets, onboarding drafts …)   │
   │  • Cube proxy (x-cube-workspace)   │
   │  • Cube token minting              │
   │  • Chat proxy (inject creds+owner) │
   └───┬───────────┬──────────┬─────────┘
       │           │          │
       │ writes    │ /api/chat │  /cube-api  (+ direct /cubejs-api)
       │ YAML      │  proxy    │
       ▼           ▼          ▼
  ┌─────────┐  ┌──────────────┐   ┌──────────────────────┐
  │ cube-dev│  │ chat-service │──▶│  Cube semantic layer │
  │  YAML   │  │ Fastify :3005│   │  :4000 / :16000      │
  │  models │  │  NL→query,   │   │  /meta /load /sql    │
  └────┬────┘  │  sessions,   │   └──────────┬───────────┘
       │       │  stream reg. │              │
       └───────┴──────────────┴──────────────┘
         cube-dev YAML is what Cube compiles & serves
```

### Key request flows

1. **Query / meta (Playground, Data Model, dashboards).** SPA → `/cube-api/*` → gateway `cube-proxy.ts` → the Cube backend chosen by the `x-cube-workspace` header (client never sees Cube URLs). Tokens minted on demand via `GET /api/playground/cube-token?game=<id>` (`cube-token.ts`); `use-cube-token-bootstrap.ts` re-fetches on game switch so each Cube request carries the right `game` claim. A legacy `/cubejs-api/*` path proxies straight to Cube (`:4000`) for non-workspace-aware callers.

2. **Chat turn (SSE).** SPA `POST /api/chat/sessions/:id/turn` → gateway `chat.ts` (injects Cube creds + `X-Owner-Id`, gated by `CHAT_FEATURE_ENABLED`) → chat-service. chat-service resolves slots (disambiguation memory cascade), builds a Cube query, may call Cube to execute, and streams SSE back **through** the gateway to the SPA's `chat-stream-store.ts`. The per-turn ring buffer in `stream-registry.ts` lets a refreshed client reattach mid-turn via the replay endpoints.

3. **Persistence + onboarding.** SPA → `/api/*` → gateway → SQLite for CRUD (segments, analyses, presets, dashboards, glossary). Model onboarding additionally writes **Cube YAML into the cube-dev repo** atomically (`cube-model-writer.ts`) and polls Cube `/meta` to validate — the bridge between the gateway and the semantic layer (see *Data-Model Lifecycle* below).

### Dev / build

`npm run dev:all` (`scripts/dev-all.mjs`) runs vite + gateway + chat-service + a Cube watchdog under `concurrently`. Each tier builds independently (`build`, `server:build`, `chat:build`); the SPA ships as static `dist/` served behind the same origin as Cube in prod (see [`deployment-guide.md`](./deployment-guide.md)).

---

## Chat Disambiguation Memory

The chat assistant learns from user interactions to auto-fill ambiguous slots (metric, dimension, timeRange, filter) in future turns. The system uses a 3-layer cascading memory that trades off latency, durability, and re-resolution freshness.

### Layer 1: Session Memory (In-Memory KV Cache)

**Scope:** Current chat session only.
**Lifetime:** Session duration (cleared on new session).
**Trigger:** Write on every confident slot resolution during the turn.

Session memory holds `SlotMemory<T>` — a wrapper pairing the resolved value with the user's original phrase:
```json
{
  "value": { "cubeId": "mf_users", "measureId": "revenue" },
  "phrase": "revenue by metric"
}
```

For `timeRange` slots, the phrase (e.g., "this week") is the most important part; the phrase resolver re-anchors it to the current calendar week at read time, preventing day/week boundaries from freezing the session's view.

**Read path:** Disambiguator queries layer 1 first. Cache hit → fill slot without prompting user.

**Code:** `chat-service/src/cache/disambig-memory-adapter.ts`

### Layer 2: Turn-Level Session Memo

**Scope:** Multi-turn sessions; survives prompt + clarification cycles.
**Lifetime:** For the duration of a session, across all turns.
**Trigger:** Conceptually "every turn," but subsumed by L3 writes (see below).

Turn-memo exists to handle the scenario where users clarify a single turn's ambiguity in a follow-up turn. Once clarified, the memory persists for the session even if not explicitly auto-filled in L1 again.

**Code note:** L2 is implemented as part of the cascading read/write in `disambiguate-memory-merge.ts`. It shares storage with L1 (both sit in kv_cache) and is logically separated by turn tracking.

### Layer 3: Cross-Session User Preferences (SQLite Table)

**Scope:** Durable per-owner, per-game user preferences.
**Lifetime:** Indefinite; survives logout/login and app restarts.
**Trigger:** Write on every confident slot resolution; read on L1/L2 cache miss.

New table `user_disambig_prefs`:

| Column | Type | Notes |
|---|---|---|
| owner_id | TEXT | User identifier |
| game_id | TEXT | Game context |
| slot | TEXT | Slot name (metric / dimension / timeRange / filter) |
| value_json | TEXT | Resolved value + original phrase |
| hit_count | INTEGER | How many times this preference was used |
| last_used_at | INTEGER | Unix timestamp, enables LRU queries |
| created_at | INTEGER | Record creation time |

**Composite PK:** `(owner_id, game_id, slot)` — one preference per slot per user per game.
**Index:** `(owner_id, last_used_at DESC)` — powers "what does this user usually mean" queries for the Settings UI.

**Read path:** L1 miss → L2 miss → query L3 (owner + game + slot) → fill slot.

**Write path:** Every confident slot write lands in both L1 (session) and L3 (durable) simultaneously. This allows preferences to accumulate across sessions while staying fresh in the active session.

**Code:**
- CRUD: `chat-service/src/cache/user-prefs-adapter.ts`
- Read/write bridge: `chat-service/src/tools/disambiguate-user-prefs-fill.ts`
- Migration: `chat-service/src/db/user-disambig-prefs-migrate.ts`

### Phrase Resolution at Read Time

When a timeRange slot is resolved from L3, the disambiguator uses the phrase (not the computed date pair) as the semantic identifier because the phrase is what the user actually meant. The phrase resolver runs at read time, re-anchoring relative expressions:

- `"this week"` → resolves to Monday–Sunday of the current week
- `"this month"` → resolves to day 1–last of the current month
- `"last 7 days"` → rolling window from today backward

This means a user sets a preference "this month" in May (May 1–31), and in June when the session reopens, the same phrase re-resolves to June 1–30 without manual re-entry.

**Code:** `chat-service/src/nl-to-query/phrase-resolver.ts` (add `"this week"` / `"tuần này"` / `"this month"` / `"tháng này"` rules).

### Settings UI + HTTP API

The Settings → Chat tab surfaces a "Remembered defaults" card listing every user preference from L3, with per-row clear and clear-all affordances.

**Three new routes** (all owner-scoped):

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat/user-prefs` | GET | List all preferences for owner+game |
| `/api/chat/user-prefs/:slot` | DELETE | Clear one slot preference |
| `/api/chat/user-prefs` | DELETE | Clear all preferences for owner+game |

Server response includes readable labels (resolved cube member shortTitles via warm meta cache), with user's phrase preferred over computed dates for timeRange.

**Code:**
- Routes: `chat-service/src/api/chat-user-prefs.ts`
- Label resolution: `chat-service/src/api/chat-user-prefs-labels.ts`
- Client: `src/api/chat-user-prefs-client.ts`
- FE component: `src/pages/Settings/chat-remembered-defaults-list.tsx`

### Summary: The Cascade

```
User resolves "metric = revenue" in T0 of session #123

  → L1 write: kv_cache[session:123:metric] = { value: revenue, phrase: "..." }
  → L3 write: user_disambig_prefs(owner_id, game_id, "metric") = { value_json: ..., last_used_at: now }

Later in same session (T2):
  → Disambiguator queries L1 → HIT → fills metric without asking

Next session (#456):
  → Disambiguator queries L1 → MISS
  → Disambiguator queries L3 → HIT → fills metric

If user clarifies in follow-up turn:
  → Phrase re-resolves at read time (e.g., "this month" → current calendar bounds)
  → Both L1 and L3 update atomically
```

---

---

## Connector Management & Multi-Source Modeling

Users can now edit data connections from the product UI (CRUD on `/api/onboarding/connectors`), materialize env-only connectors as editable DB rows, and model executable cross-game joins or advisory cross-source links. Three architectural constraints:

1. **Secrets sealed at rest.** Vault (`AES-256-GCM` via `CONNECTOR_SECRET_KEY`) encrypts secrets before persist; never returned to browser or logged. Edit with blank secret preserves existing sealed credential.
2. **Same-source joins are executable.** Cubes sharing the same `data_source` (connector ID) may join regardless of game boundary. Trino federates schemas within `game_integration` catalog so cross-game (ballistar ↔ cfm) is live SQL.
3. **Cross-source joins are advisory only.** Cubes on different connectors (dataSources) can be declared linked via `/api/onboarding/cross-source-links`, but Cube's engine cannot execute SQL across dataSources — only within one. Cross-source links flag rollupJoin or ETL opportunities without false-promise of live join.

### Connector Lifecycle

**Bootstrap-seed:** On boot, if `CONNECTOR_SECRET_KEY` is set and no DB `connectors` row exists for the env-seeded Trino connection (`TRINO_PROFILER_*` env vars), the service auto-materializes it as an editable DB row. Without the vault key, the connection stays read-only env seed. Worked-example connector (`existing-model`) is always read-only and refuses edit/disable.

**Edit/Disable:** PATCH `/api/onboarding/connectors/:id` accepts field updates (host, port, etc.); secrets in the PATCH body blank means "keep the existing sealed value." POST `/api/onboarding/connectors/:id/disable` soft-disables, marking the row inactive. Append-only audit trail via `connector-store.ts` write path. Edit/disable enforce `enforce-write-roles` RBAC + game-grant re-checks.

**Registry sync:** Each connector writes a secret-free entry to `datasources.config.json` (via `datasource-registry-writer.ts`) — the config-not-code contract that Cube reads to resolve per-dataSource drivers. Multiple connectors co-exist in a single model because cubes are stamped with `data_source: <connectorId>`.

### Cross-Game Executable Join

When a user joins cubes from different games (both under Trino), both cubes share `data_source: trino` and the join is **executable** — Trino federates schemas within the `game_integration` catalog. New POST `/api/onboarding/cross-game-join` accepts an initiating cube + target cube + join predicate. Route enforces grant intersection: user must hold write access to **both** games (403 if not). Scaffolder emits a fully-qualified join:

```yaml
join:
  name: to_other_game_table
  relationship: one_to_many
  sql: "{TABLE}.id = {OTHER_GAME_SCHEMA}.other_table.id"
```

The join compiles to YAML and is executable in `/load` because both cubes resolve to the same Trino dataSource.

### Cross-Source Advisory Link

Users declare relationships between cubes on **different** connectors (e.g., Trino → ClickHouse, Trino → Postgres). These are **non-executable** — never compiled to YAML. New migration `025-cross-source-links.sql` + API (`GET/POST/DELETE /api/onboarding/cross-source-links`) surfaces them in the graph as dashed edges. Link payload includes a `kind` enum (rollupJoin / ETL / other) to flag the intended bridge:

```json
{
  "from_cube_id": "ballistar.users",
  "to_cube_id": "clickhouse_warehouse.events",
  "kind": "rollupJoin",
  "is_executable": false
}
```

The `is_executable: false` flag is advisory — a UI affordance that prevents false promises of live joins across dataSources. Future: auto-suggest rollupJoin bridges or ETL sync patterns.

**RBAC:** Cross-game join requires both-game grant intersection. Cross-source link requires only initiating-game grant (no execute intent, so looser scoping).

---

## Data-Model Lifecycle: Bootstrap → Reconcile → Repair

Cube-model onboarding implements the **bootstrap stage** (introspect raw warehouse → stage drafts). Surfaces integrate at reconcile (coverage + drift surfaces) and repair (manual/auto repoint).

### Stage 1: Bootstrap (Onboarding)

A data analyst connects a warehouse (Trino) via app-side connector creds (`TRINO_PROFILER_*` env) and triggers introspection. The `raw-schema-inference.ts` service profiles columns, infers Cube-model skeleton (dimensions, measures, time dimension, PK, joins) with confidence + warm/cold priors, and scaffolds a Zod-validated Cube model. Scaffolder emits block-style YAML; drafts live in `onboarding_draft_models` table (pending → accepted → rejected → written states). Approval writes YAML atomically to cube-dev and polls /meta for validation.

**Key services:** `trino-profiler.ts`, `raw-schema-inference.ts`, `cube-model-scaffolder.ts`, `onboarding-draft-store.ts`.

**Gating:** LLM enrichment (`onboarding.llmEnrichment`) and golden-query seeding (`onboarding.goldenSeeding`) default off; flag-tunable.

**Multi-source connect (v2).** `/data` is the product layer for the full lifecycle, not just Trino:

- **Connect (real).** A source type is declared once in `source-type-registry.ts` (field schema + Cube driver + capability flags). The connect form (`connector-connect-form.tsx`) renders those fields dynamically; `POST /connectors/test` SSRF-guards (`connector-host-guard.ts`) + probes; `POST /connectors` encrypts the secret (`connector-secret-vault.ts`, AES-256-GCM) into `connectors` (migration 024) and writes a secret-free entry to `datasources.config.json` (`datasource-registry-writer.ts`). That registry is the **config-not-code contract**: a generalized cube.js reads it to build a driver per `dataSource`, so adding a source never edits cube.js again.
- **Introspect (per type).** `profiler-interface.ts` `getProfiler(connector)` dispatches by source type — Trino REST profiler (reference) or the ANSI `information-schema-profiler.ts` (injectable `SqlRunner`, driver-pluggable). Non-introspectable / not-yet-wired types return an honest 501.
- **Build (guided).** The triage canvas adds a step-by-step builder view (`view-builder.tsx`: Cube → Dimensions → Measures → Joins → Preview) over the same `use-onboarding-draft` engine; YAML is the compiled output at the Preview step, not the editing surface. The existing committed model renders read-only as a worked example (`existing-model-reader.ts` + connector **Model** tab).
- **Merge (model layer).** Cubes carry `data_source` so multiple connectors co-exist in one model. `join-source-classifier.ts` labels joins same- vs cross-source; cross-source links are declared with a rollupJoin advisory (not executed — Cube can't SQL-join across dataSources).

**Secrets/SSRF posture:** secrets sealed at rest + never returned to the browser; user-supplied hosts pass an SSRF guard (loopback + cloud-metadata blocked, RFC1918/internal allowed). Flagged for a `/ck:security` review before prod enablement.

### Stage 2: Reconcile (Coverage & Drift)

Once a model is written, two surfaces monitor alignment:

- **Metric coverage** (`metric-coverage-resolver.ts`): Detects broken refs (metrics pointing to non-existent members) and uncovered cube measures (live members with no metric yet). API: `GET /api/business-metrics/coverage`. Scaffolds metric stubs via `metric-stub-scaffolder.ts`.
- **Metric drift** (drift-center): Detects column/member drift (schema changes upstream). Detector polls `/meta` + compares historical schema snapshots. Feeds the triage canvas.

### Stage 3: Repair (Manual + Auto)

Data analysts use drift-center and coverage surfaces to triage misalignments — repoint broken refs, scaffold missing metrics, update model members. Future: auto-repair hooks (schema reconciliation templates, cross-game mirroring).

---

## Unified Concept Fabric: Trust, Registry & Reverse Index

Semantically unified layer bridging glossary terms, business metrics, and segments with a shared trust/visibility model, bidirectional reference tracking, and concept-aware authoring.

### Trust & Visibility Model

**Trust tiers** (draft → certified → deprecated) and **visibility** (personal → shared → org) apply uniformly across all concept types. Server derives these on read from legacy YAML + DB fields via `trust-mapping.ts`:

- Glossary terms: mapped from legacy `status` + `trustTier` columns.
- Metrics: read from YAML `trust` key (existing) + new `visibility` key (optional).
- Segments: read from nullable `visibility` column (migration 028; NULL → personal on read).

Write-side logic remains in YAML for metrics, SQL for glossary/segments; trust & visibility are derived read-time metadata, not persisted (yet), enabling future migration without schema thrashing.

**Migrations:** 
- `027-glossary-unified-trust-visibility.sql`: adds `trust`, `visibility` nullable columns to `glossary_terms` (not yet populated).
- `028-segments-visibility.sql`: adds nullable `visibility` column to `segments`.

### Concept Registry & Dangling-Ref Guard

Glossary `secondaryCatalogIds` (links from a term to metrics/segments) now validated on write:

- **Namespace allowlist:** refs must match `^(business_metrics|data_model|segments)/[a-z0-9_-]+$`.
- **No path traversal:** `..` blocked.
- **Delete-time integrity:** `concept-ref-integrity.ts` enforces: if a segment or metric is deleted, any glossary term referencing it returns 409.

**Routes:**
- `POST/PUT /api/glossary` + `PATCH /api/glossary/:id/status` validate refs at write.
- `DELETE /api/segments/:id` + `DELETE /api/business-metrics/:id` check concept refs before cascade.

### Concept Reverse-Index Service

`concept-reverse-index.ts` derives three edge types per (workspace, game), cached at the service layer:

1. **field→metrics:** which metrics use a given cube field (via dimension/measure refs).
2. **metric→fields:** which fields compose a given metric (reverse of above).
3. **field/term→segments:** which segments filter on a given dimension/glossary term.

Caches keyed by (workspaceId, gameId); invalidated atomically on glossary/metric/segment writes.

**New endpoint:** `GET /api/concepts/:namespace/:id/relations`

Returns:
```json
{
  "concept": { "namespace": "business_metrics", "id": "revenue", "trust": "certified", "visibility": "org" },
  "edges": [
    { "source": { "type": "metric", "id": "revenue" }, "verb": "used_by_metrics", "target": { "type": "segment", "id": "high_spenders" } },
    { "source": { "type": "field", "id": "mf_users.total_spent" }, "verb": "composed_by_metrics", "target": { "type": "metric", "id": "revenue" } }
  ]
}
```

### Authoring & Governance

**Write-RBAC:** `/api/glossary/*` and `/api/concepts/*` routes added to `PROTECTED_PREFIXES` (viewers blocked; editor+ allowed).

**Trust PATCH:** `PATCH /api/business-metrics/:id/trust` (admin-only; validates refs via Cube `/meta`) certifies a metric from draft → certified.

**Promotion:** `POST /api/concepts/promote` (editor+, IDOR-safe)

Takes a segment and optionally promotes it to:
- A new draft glossary term (with auto-generated definition).
- A new draft metric stub (optionally wrapping the segment's count measure).

Promotion is atomic and scoped by workspace (no cross-workspace promotion leakage).

**Related services:**
- `promote-to-term.ts`: segment → term + metric stub generation.
- `concept-promote.ts` (route): handles the HTTP request, IDOR, and persistence.

### Concept Frontend Components

**ConceptChip** (`src/components/concept-chip/`): Renders a concept reference with glyph + label + optional trust badge.
- Glyphs: ▦ (metric), ⓘ (glossary term), ＃ (field), ◑ (segment).
- Badges: draft/certified/deprecated labels.
- Interactive: click → navigate; hover → card delay.

**ConceptHoverCard** (`src/components/concept-hover-card/`): On hover, fetches relations and renders:
- Concept header (type + trust + visibility).
- Categorized edges (used_by_metrics, composed_by_terms, filtered_by_segments) as navigable chips.
- Throttled relation fetch (500 ms debounce, per-concept cache).

**Usage:** Chat assistant message flow (glossary terms inline), Catalog glossary rows (secondary refs as chips), Segments row actions (promotion affordance).

### Cross-Layer Explorer

Schema Cartographer (`/catalog/data-model/:cubeId` detail) now surfaces reverse edges as a dedicated panel:

- **Concept Relations Section:** Shows every reverse edge from the selected field/member, grouped by verb (used_by, composed_by, filtered_by).
- **Layer Filter Pills:** Toggles visibility of metrics / terms / fields / segments in the edge list.
- **Generalized `?focus=` param:** Accepts namespaced refs (`metric:revenue`, `segment:high_spenders`, `term:customer_lifetime_value`) or bare cube member name (backward compatible).

---

---

## Per-User Segment Isolation & Visibility Model

Segments now enforce visibility scope via a nullable `segments.visibility` column and server-side filtering. Three visibility levels: `personal` (owner-only), `shared` (workspace-visible), `org` (org-visible, future expansion). Legacy segments with NULL visibility are treated as `personal` after enforcement.

### Visibility Enforcement (SQLite, main server)

Existing nullable column `segments.visibility` (migration `028-segments-visibility.sql`), enforced on read:
- `personal` — owner-only; non-owners see 403 on detail, not in list.
- `shared` — workspace-visible; members of same workspace see in list + detail.
- `org` — org-visible (reserved for future; not enforced differently yet).
- NULL (legacy) — treated as `personal` on read via COALESCE.

**List filtering:** `WHERE COALESCE(visibility, 'personal') IN (<allowed>)`. The `<allowed>` set depends on the requesting user:
- Owner can see: personal + shared + org.
- Non-owner in same workspace can see: shared + org (not personal).
- User outside workspace can see: org only (if ever enabled).

**Detail route:** Explicit permission check before response; 403 if denied.

### Behavior Change: Legacy Segments

Segments created before `visibility` enforcement had NULL visibility. After enforcement:
- **Old behavior:** LIST routes returned all rows (no filter). Teammates saw all segments.
- **New behavior:** LIST routes filter via COALESCE. Legacy NULL becomes personal → only the owner sees them.

**Impact:** Teammates who relied on viewing shared segments no longer see them unless owners re-grant visibility. No automatic backfill; the behavior change is intentional. Owners decide which segments to re-share.

**Mitigation:** 
1. Changelog + release notes clearly state the change.
2. Settings panel (future) or direct support: owners click a visibility icon to re-share segments.
3. No data loss — rows persist; filtering just changes who sees them.

---

## Activity Telemetry Spine & Admin Hub Observability

Append-only event recording + admin hub backend separating **two mental models**: Access (write-governed identity & grants) and Observability (read-only usage telemetry). Sub-keyed identity (Keycloak `sub` + email snapshot) bridges auth + observability without PII leakage.

**Critical identity model:** Artifacts/telemetry key on Keycloak `sub` (the immutable user identifier). Access grants + admin UI key on lowercased email (stable, user-visible, indexable). Canonical mapping = `user_access.kc_sub` (the single source of truth). Email is a display-only join; never use it as the primary key for telemetry reads. Admin aggregation routes resolve email→sub via `user_access.kc_sub` as a prerequisite before any sub-keyed reads.

### Event Spine (SQLite, main server)

New table `activity_events` (migration `029-activity-events.sql`):

| Column | Type | Index | Notes |
|---|---|---|---|
| `id` | INTEGER PK | – | Auto-increment. |
| `actor_sub` | TEXT | ✓ | Keycloak subject (always present, per-user auth identity). |
| `actor_email` | TEXT | – | Nullable display snapshot (nullable: refreshed on session change). |
| `event_type` | TEXT | ✓ | Closed enum: `query_run`, `segment_op`, `feature_open`, `export`, `workspace_switch`. |
| `target_type` | TEXT | – | Optional target context: `segment`, `metric`, `dashboard`, etc. |
| `target_id` | TEXT | – | Scoped identifier if applicable. |
| `workspace` | TEXT | – | Workspace context. |
| `game` | TEXT | – | Game context. |
| `detail_json` | TEXT | – | Flexible event metadata (query shape, segment name, export format, etc.). |
| `ts` | INTEGER | ✓ | Unix timestamp, primary sort key for aggregations. |

**Indices:** `(actor_sub, ts)` for per-user timelines; `(event_type, ts)` for global event scans.

**Fire-and-forget semantics.** `recordActivity(event)` in `activity-store.ts` is non-blocking, runs outside caller's transaction, never throws (logs WARN on disk-full but continues). Append-only — no deletes except retention sweep.

### Emit Points

**Server-only events** (forged-proof):
- `query_run` — cube-proxy `/load` on HTTP 200 (GET + POST).
- `segment_op` — segments create/update/delete/append/refresh via routes.

**Client-forged allowlist** (`POST /api/activity`):
- `feature_open` — user opened a feature (page, tab, modal).
- `export` — user initiated a data export.
- `workspace_switch` — user switched workspace or game.

Client events are not trusted for attribution; they may supply contextual data (export format, feature name) but `actor_sub` is always resolved server-side from the auth token.

**Event-type enum:** `server/src/services/activity-event-types.ts` (closed set).

### Chat Stats Bridge

chat-service gained a new internal-only endpoint `GET /internal/stats` (bulk query by `sub[]`). Returns per-user stats: total turns, total cost, last active timestamp. Behind a **mandatory `INTERNAL_SECRET` inbound gate** (`chat-service/src/middleware/internal-secret.ts`).

Unlike the main server's `GET /internal/access` (which fails open under `AUTH_DISABLED`), the chat stats route **never** fails open — missing or mismatched `INTERNAL_SECRET` → 403, period. This guards against accidental exposure.

**Server-side client:** `server/src/services/chat-stats-client.ts` (requests with timeout; degrades to null counts on timeout or error).

### Session Derivation (Gap-Based Sessionization)

Sessions are **derived on read** from the append-only `activity_events` table — not stored as a separate entity. New service `server/src/services/session-aggregator.ts` implements gap-based sessionization: consecutive events within an idle window (60 min) belong to one session; gaps >60 min mark session boundaries.

**`GET /api/admin/activity/users/:email/sessions`** — Per-user session timeline:
- Sessions most-recent first, capped by optional `?limit` query param.
- Each session: `{ start, end, durationMs, events }` where events carry timestamps, type, target (for feature_open), and privacy-safe query shapes (cubes + measures + dimensions only, no filter values).
- Total count across 30-day window + mean session duration.
- Returns 404 for unknown users; known users with no events return an empty (non-null) timeline.

This provides a separate, lightweight per-user timeline view for the Observability tab without fetching heavy activity aggregations, enabling responsive drill-in performance.

### Admin Hub IA (Two Tabs)

The redesigned `/admin` hub cleanly separates two mental modes via tab navigation:

**Users & Access tab** (`/admin/access`):
- **Purpose:** Govern user identity and capability grants (write-gated).
- **Surfaces:** Users list → per-user panel with identity strip + role/status controls + workspace/game/feature grants.
- **Performance:** Per-user panel fetches ONE light call to `/api/admin/activity/users/:email/sessions?limit=5` for session count only (no heavy activity rollup on selection). Session count powers a badge (e.g., "3 sessions in 30d").
- **Modules:** `per-user-panel.tsx` (lean identity + grants), `access-controls.tsx` (workspace/game/feature grant cards), `feature-access-section.tsx` (feature matrix).

**Observability tab** (`/admin/observability`):
- **Purpose:** Observe org and per-user activity (read-only telemetry).
- **Surfaces:** Org KPI strip (active users 7d/30d, total queries, top features) + PENDING-APPROVAL queue (promoted from Access tab for visibility) + inactive users list + top feature heatmap + audit log.
- **Drill-in:** Per-user detail route `/admin/observability/:email` with a segmented Access | Activity toggle—same subject, two lenses. Access lens reuses `AccessControls` from the Access tab; Activity lens fetches full vitals + session timeline + derived query shapes + change audit.
- **Modules:** `observability-tab.tsx` (org KPI + queue + triage), `pending-approval-queue.tsx` (list + inline approve/deny), `user-activity-profile.tsx` (sub-route detail with toggle), `activity-profile.tsx` (full vitals + timeline), `session-timeline.tsx` (visual session bands).

**Pending-approval promotion:** Users awaiting role assignment now appear in a dedicated Observability queue (not buried in the Access tab) with one-click Approve/Deny (PATCH `{status:'active', role}` or `{status:'disabled'}`). A live "N pending" badge shows count.

### Admin Aggregation Routes (admin-gated)

**`GET /api/admin/activity/summary`** — Org-wide rollup:
- Status counts (active users, total events this period).
- Active user counts (7d, 30d window).
- Inactive user list (no login >30d; `INACTIVE_DAYS` constant in `activity-aggregator.ts`, = 30; not env-configurable yet).
- Top features (by `event_type` frequency).
- Total chat turns (from chat stats bridge; degrades to null if chat offline).

**`GET /api/admin/activity/users/:email`** — Per-user deep-dive:
- Last login timestamp.
- Segment count (live + all-time from segment metadata).
- Recent features accessed (last 10 events, with timestamps).
- Query shapes (dimensional profile of cube references from recent `query_run` events; PII allowlist: **member names only** — no dimension values, UIDs, date ranges, or other sensitive payload).
- Chat stats (total turns, total cost, last turn timestamp; null if chat unavailable).

**PII-safe query-shape projection:** `activity-store.ts` `projectQueryShape(detail_json)` extracts only `{cubes: string[], measures: string[], dimensions: string[]}` — the structural profile — never the filter values or user data queried.

### Retention & Cleanup

`server/src/jobs/prune-activity-events.ts` — daily background job that hard-deletes `activity_events` older than 90 days (`ACTIVITY_RETENTION_DAYS` constant; not env-configurable yet). Logs row count deleted.

### Summary: Request Flow

```
Browser                          Gateway server                    Chat service
  │                                  │                                │
  │ POST /api/activity               │                                │
  │ (forged-proof event)             │                                │
  ├─────────────────────────>│       │                                │
  │                          │       │ [recordActivity]               │
  │                          │       │ → activity_events table        │
  │                          │       │                                │
  │ GET /api/admin/access/:email     │                                │
  │ (light: session count)           │                                │
  ├──→ GET /api/admin/activity/users/:email/sessions                  │
  │    (5 most-recent only)          │                                │
  │                          │       │ [buildUserSessions]            │
  │                          │       │ (gap-derived from events)      │
  │                          │       │                                │
  │ GET /api/admin/observability/:email (full vitals)                 │
  │ + GET /api/admin/activity/summary   (org rollup)                  │
  ├─────────────────────────>│       │ GET /internal/stats [sub[]] │
  │                          │       ├───────────────────────────────>│
  │                          │       │ (secret-gated)                 │
  │                          │       │<───────────────────────────────┤
  │ JSON responses           │       │ { [sub]: {turns, cost, ts} }   │
  │<─────────────────────────┤       │                                │
```

---

## Future Directions

**Semantic cache deferred** — exact-match cache (Layer 4) deferred pending production hit-rate measurement. If exact-match hit-rate <10%, revisit embedding-based semantic matching via a higher-latency service.

**L3 eviction policy** — currently unlimited. If L3 grows unbounded, consider LRU eviction based on `last_used_at` with a high-tide mark (e.g., keep top-N per slot per owner).

**Auto-repair stage** — stage 3 (Repair) currently manual. Future: template-driven auto-remediation (e.g., schema reconciliation, cross-game model mirroring).

**Activity dashboard (Phase 5+)** — admin console with detailed user cohorts, feature heatmaps, and anomaly alerts (workspace-isolation plan, deferred).
