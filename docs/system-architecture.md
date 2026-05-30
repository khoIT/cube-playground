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

## Data-Model Lifecycle: Bootstrap → Reconcile → Repair

Cube-model onboarding implements the **bootstrap stage** (introspect raw warehouse → stage drafts). Surfaces integrate at reconcile (coverage + drift surfaces) and repair (manual/auto repoint).

### Stage 1: Bootstrap (Onboarding)

A data analyst connects a warehouse (Trino) via app-side connector creds (`TRINO_PROFILER_*` env) and triggers introspection. The `raw-schema-inference.ts` service profiles columns, infers Cube-model skeleton (dimensions, measures, time dimension, PK, joins) with confidence + warm/cold priors, and scaffolds a Zod-validated Cube model. Scaffolder emits block-style YAML; drafts live in `onboarding_draft_models` table (pending → accepted → rejected → written states). Approval writes YAML atomically to cube-dev and polls /meta for validation.

**Key services:** `trino-profiler.ts`, `raw-schema-inference.ts`, `cube-model-scaffolder.ts`, `onboarding-draft-store.ts`.

**Gating:** LLM enrichment (`onboarding.llmEnrichment`) and golden-query seeding (`onboarding.goldenSeeding`) default off; flag-tunable.

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
