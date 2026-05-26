# Cube-Playground Segment Architecture: Current State Snapshot

**Date:** 2026-05-26  
**Scope:** Segment model, lifecycle, activation, identity mapping, and downstream handoff patterns.

---

## 1. Segment Model — Definition & Persistence

**Smoking Gun:** `/Users/lap16299/Documents/code/cube-playground/server/src/types/segment.ts` lines 22–45 and `/Users/lap16299/Documents/code/cube-playground/server/src/db/migrations/001-init.sql` lines 1–56.

**Canonical shape:** A segment is a named user cohort with:
- **Predicate or Manual type** (`type: 'manual' | 'predicate'`).
- **Predicate segments** store a `predicate_tree_json` (filter tree) + `cube_query_json` (translated to Cube's filter format) — these are *live*, recomputing on refresh.
- **Manual segments** store a static `uid_list_json` (array of user IDs).
- **Both** store materialized `uid_count` (true distinct count from Cube via `total: true` in refresh-segment.ts) and `uid_list_json` (sample up to 100k UIDs, or full list for manual segments).
- **Game-scoped:** each segment binds to a `game_id` (added in migration 004, backfilled to 'ptg').
- **Owner-enforced:** writes reject when row.owner ≠ request.owner.

**Database table:** `segments` (SQLite) with 19 columns including `id`, `name`, `type`, `owner`, `status`, `cube`, `predicate_tree_json`, `cube_query_json`, `uid_count`, `uid_list_json`, `refresh_cadence_min`, `last_refreshed_at`, `game_id`, `activations_json`.

---

## 2. Segment Lifecycle — Create, Edit, Refresh

**Routes:** `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts` lines 72–579.

**Creation:** POST `/api/segments` accepts a `SegmentInput` with name, type, predicate_tree, tags, optional uid_list, game_id. For predicate segments:
- `treeToCubeFilters()` translates predicate → Cube query JSON.
- Status flips to 'refreshing' immediately (line 143), triggering an async refresh job to compute the true uid_count.
- Manual segments start 'fresh' with their submitted uid_list as the cohort.

**Editing:** PATCH `/api/segments/:id` allows updating name, cube, tags, predicate_tree, uid_list. When predicate changes, status flips to 'refreshing' again (line 246).

**Refresh:** POST `/api/segments/:id/refresh` enqueues a background refresh via `enqueueRefresh()`. Cron worker drains the queue asynchronously.

**Lifecycle stages:**
- **'fresh'** — idle, uid_count & uid_list are current.
- **'refreshing'** — Cube query in flight; UI shows in-progress state.
- **'broken'** — Cube error or schema drift; broken_reason stored.
- **'stale'** — transient network error during refresh; prior values preserved.

**Live vs Frozen:** Predicate segments are *live*—re-executed on each refresh cadence (cron or manual trigger). Manual segments are *frozen*—uid_list is the static cohort, never recomputed.

---

## 3. Activation/Export Today — "Activate to CDP"

**Smoking Gun:** `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/push-modal/tabs/activate-to-cdp-tab.tsx` lines 1–150, `/Users/lap16299/Documents/code/cube-playground/src/api/cdp-metrics-client.ts` lines 1–59, `/Users/lap16299/Documents/code/cube-playground/server/src/types/segment.ts` lines 10–20, `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts` lines 494–552.

**What it does:** The UI collects:
- `metric_name` (derived from segment name, validated `/^[a-z0-9_]{1,64}$/`).
- `expression` (hardcoded: `COUNT(DISTINCT ${identityField})` or `COUNT(DISTINCT user_id)`).
- `filter` (server-side SQL translation of predicate_tree via `predicateToSql()`, or `1=1` for manual segments).
- `source` (derived from game_id + cube, e.g., 'ptg.users_hub').
- `dimensions` (optional, defaulting to `['server_id', 'platform']`).
- `env` (dev | stag | prod).
- `materialize` (optional cron schedule for periodic refreshes).

**Payload shape:** POST to `/api/cdp/v1/metrics` (mock mode in dev) with `CreateMetricPayload` struct.

**Sync vs Batch:** Currently **mock-only** (behind `VITE_CDP_ACTIVATION_ENABLED` flag). Real backend to land in Phase 7. Mock returns synthetic success after 500ms.

**Downstream:** After CDP create succeeds, the UI chains to POST `/api/segments/:id/activations`, persisting an `Activation` record (id, destination='cdp', game_id, env, metric_name, registered_at, last_pushed_at, status='active'|'failed'|'pending') as JSON in the segment's `activations_json` column. No real user-list sync to Apollo yet.

**No materialized user list handoff today:** The segment holds the uid_list in-memory; Apollo receives only the metric definition (expression, filter, dimensions), not the actual UIDs.

---

## 4. Catalog vs Segments — Relationship

**Catalog** is a read-only metric library (business-metric definitions, dimensions). **Segments** are named user cohorts. They are **orthogonal**, not linked:
- A segment *can* be authored from a Catalog metric (user can construct a segment that filters by a metric threshold, e.g., "users with high LTV").
- A metric *cannot* be authored from a segment (segments are post-query artifacts, not reusable business definitions).
- The UI does not expose "create segment from metric"—creation is either manual upload, or from a query result via the QueryBuilder.

---

## 5. Chat → Segment: Tool & Flow

**Smoking Gun:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/list-segments.ts` and `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/get-segment.ts`.

**Chat-service tools:**
- `list_segments(game)` — lists all segments for a game, returning id, name, type, uid_count, last_refreshed_at.
- `get_segment(id)` — fetches the full segment record including predicate_tree, cube, uid_count, sample_uids (first 20 for token efficiency), last_refreshed_at.
- `emit_query_artifact(title, summary, query, source='segment', sourceRef)` — emits a clickable Cube-query card *from a query result*, with source type including 'segment'.

**Can chat produce a segment today?** **No.** The chat tools allow *consuming* segments (list, get, pass to model for analysis), but not *creating* or *saving* them. The model can emit a query artifact referencing an existing segment ID, but saving a new segment requires the QueryBuilder UI (QueryBuilderResults → SegmentsSaveBar → PushModal).

---

## 6. Game Scoping — Single vs Multi-Game

**Smoking Gun:** `/Users/lap16299/Documents/code/cube-playground/server/src/db/migrations/004-game-scoping.sql`, `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts` lines 93–96, `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts` lines 164.

**Model:** Each segment holds a `game_id` column (required, backfilled to 'ptg'). Routes filter by game_id at query time (line 94: `WHERE game_id = ?`). 

**Queries are per-game:** GET `/api/segments?game_id=ptg&owner=alice` returns only segments owned by alice in the ptg game.

**Apollo UI distinction** ("Single Game / Multiple Games") is *not yet modeled* in cube-playground. Segments today are implicitly single-game (bound to the game_id they were created under). Multi-game segments would require:
- Either a many-to-many join (segment_id ↔ game_id pairs).
- Or a `game_ids_json` array column.
- Neither exists yet.

---

## 7. Identity Mapping — User ID Resolution

**Smoking Gun:** `/Users/lap16299/Documents/code/cube-playground/server/src/routes/identity-map.ts`, `/Users/lap16299/Documents/code/cube-playground/server/src/db/migrations/001-init.sql` lines 41–49, `/Users/lap16299/Documents/code/cube-playground/server/src/jobs/refresh-segment.ts` lines 82–86.

**Maps:** `cube_identity_map` table holds (cube, identity_field, source, confidence, updated_at).
- `identity_field` is the dimension name holding the user ID in that cube (e.g., 'user_id', 'Users.id').
- `source` is 'manual' (user override) or 'auto' (suggested from /meta).
- Persisted overrides win over auto-suggestions.

**Resolution flow:** When refreshing a predicate segment:
1. Look up `identity_field` for the segment's cube via `resolveIdentityField()`.
2. Query Cube with dimensions = [identity_field] only (to extract one uid per row).
3. De-duplicate and materialize the uid_list.

**Apollo handoff:** The identity_field is exposed in the Activate-to-CDP tab (line 118 in activate-to-cdp-tab.tsx: `{identityField && <span> · identity {identityField}</span>}`). Apollo would use this to map segment UIDs back to a canonical user ID (e.g., Nexus user UUID), but that mapping is *not yet implemented* in cube-playground. The segment carries the raw identity dimension value; Apollo must perform its own ID ↔ canonical UID join.

---

## Summary

**Segments today are:**
- Persistent, SQLite-backed, game-scoped user cohorts (manual or predicate-based).
- Live (recompute on refresh) or frozen (static uid_list).
- Owned and access-controlled.
- Tied to a Cube + identity dimension for UID resolution.
- Materializeable into a uid_list (up to 100k sample; true count always available).
- Activatable to CDP via a metric-definition stub (expression + filter + dimensions), but no actual user-list sync yet.
- Readable by the chat assistant (list, get, pass to analysis), but not creatable via chat.
- Scoped per game (single-game only; multi-game model not yet built).
- Identity-mapped via a manual override table (cube → identity_field), but downstream Apollo ID normalization not handled.

**Gaps for Apollo handoff:**
1. No real CDP metrics endpoint (mock only).
2. No materialized segment-ID ↔ user-ID list export API.
3. No multi-game segment model.
4. No canonical identity (game userId ↔ Nexus UUID) mapping; Apollo must join independently.

---

**Status:** DONE  
**Summary:** Segments are a foundational model in cube-playground with live refresh, game scoping, identity mapping, and mock CDP activation. The architecture supports exporting segment metadata (predicate + filter + dimensions) but not yet user lists, and multi-game scoping is not modeled.
