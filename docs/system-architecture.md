# System Architecture

Core architectural patterns and data flows across cube-playground. Updated as major systems ship.

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

## Future Directions

**Semantic cache deferred** — exact-match cache (Layer 4) deferred pending production hit-rate measurement. If exact-match hit-rate <10%, revisit embedding-based semantic matching via a higher-latency service.

**L3 eviction policy** — currently unlimited. If L3 grows unbounded, consider LRU eviction based on `last_used_at` with a high-tide mark (e.g., keep top-N per slot per owner).

**Auto-repair stage** — stage 3 (Repair) currently manual. Future: template-driven auto-remediation (e.g., schema reconciliation, cross-game model mirroring).
