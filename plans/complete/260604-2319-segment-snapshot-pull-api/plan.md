# Segment Snapshot / Pull API — replace mock CDP activation

Status: draft · Branch: main · Owner: khoitn
Prototype: `visuals/Pull API Tab.html` (+ `visuals/pull-api-tab-preview.png`)

## Goal
Replace the mock CDP "activation" surface with a **real, pullable segment snapshot**. We are NOT
building push. A downstream app pulls a versioned snapshot once and stores it in its own store.

## What exists today (verified)
- `POST /api/segments/:id/activations` is a mock: writes a record into `activations_json`, no push,
  `last_pushed_at` never set (`server/src/routes/segments.ts:673-732`).
- Members materialized by refresh job → stored as JSON in SQLite `segments.uid_list_json`, **capped 100k**
  (`server/src/jobs/refresh-segment.ts:27`). No versioning, no truncation flag exposed.
- `GET /api/segments/:id` ships the whole uid_list to the client; search is in-browser (`sample-users-tab.tsx:88`).
- Access model: `guardSegment` + visibility personal/shared/org, server-authoritative cube tokens, activity/access audit.
- Gaps for export: no rate limit, no per-pull audit, no export-specific grant, no snapshot versioning.

## Design decisions (locked)
- Paginate (keyset cursor) **and** offer a file download URL for bulk pulls.
- Lift 100k cap → 1M; if still hit, expose `truncated: true` loudly (warning banner, not footnote).
- Per-member **projection**: identity locked-on; dims/measures opt-in. Projection change mints a new version.
- Surface identity metadata: `identity_type`, `game_id`, `env`.
- Snapshots are **immutable + versioned**; atomic pointer to "current".

---

## Phase 1 — Snapshot data model + versioning (backend)
**Files:** `server/src/db/migrations/0NN-segment-snapshots.sql` (new), `server/src/types/segment.ts`,
`server/src/jobs/refresh-segment.ts`

- New table `segment_snapshots(id, segment_id, version, snapshot_id, computed_at, data_through,
  total_count, returned_count, truncated, identity_type, game_id, env, projection_json, schema_json,
  members_ref, status, created_by)`. Members stored out-of-row (file ref or child table) — not inline JSON.
- Refresh job writes a **new** snapshot row (immutable); flip `segments.current_snapshot_id` atomically.
- `definition_hash` for cheap "changed since last pull?" (ETag). **NOTE (260607):** plan
  `260607-0025-segment-revamp-tiered-sampling-sharing-ai-brief` Phase 7 lands
  `server/src/services/segment-definition-hash.ts` first (AI brief cache key) — reuse that util
  here (extend with projection if needed), do not re-implement.
- Raise `MAX_UID_LIST` 100k → 1M; set `truncated` when the true count exceeds it.

**Done when:** a refresh produces a versioned snapshot row + atomic current-pointer; old version still readable.

## Phase 2 — Projection + schema (backend + frontend picker)
**Files:** `server/src/routes/segments.ts`, new `server/src/services/segment-projection.ts`,
`src/pages/Segments/detail/tabs/pull-api-tab.tsx` (picker), `src/pages/Segments/presets/types.ts`

- Segment declares a projection (identity + chosen dims/measures). The existing enrichment query
  (`use-member-dim-rows.ts`: `dimensions:[identityDim, ...extraDims] + measures`, filter `identityDim IN uids`)
  already supports this — adding a field = adding a `MemberColumnSpec`. No new query machinery.
- **Projection picker options come from `/cube-api/v1/meta`** of the resolved enrichment cube/view —
  only fields queryable in ONE query alongside the identity (single-cube/view rule). Exclude per-day/per-txn
  timeline views (they're not one-row-per-user without aggregation).
- Validate the projection against `/meta` on save so a renamed/dropped field is caught, not silently wrong.
- Materialize projected columns per member during refresh (extends current per-page dim fetch to full set).
- Emit a `schema[]` block: `{field, type, kind: identity|dimension|measure}`.

### Phase 2 preconditions / gating (verified against cube-dev-old `main`)
Per-member enrichment lights up only when **all** hold; the picker must gate, not assume:
1. **Flat per-user surface keyed by the segment identity.** The `mf_users` cube IS this
   (`user_id` is `primary_key`). The `user_360`/`user_profile` *view* is just a curated facet — not required.
2. **Identity match.** Segment `identityDim` must resolve to `mf_users.user_id` (via member-resolver,
   [[cube-member-resolver-workspace-abstraction]]). Segments keyed on other id spaces (event cubes, device,
   sub) can't reach `mf_users` in one query → picker shows "enrichment unavailable for this identity".
3. **Per-game coverage.** Only **5 games have `mf_users`: muaw, ballistar, pubg, jus, cfm** (~72–75 fields each,
   full parity on `ltv_usd`/`payer_tier`/`lifecycle_stage`/`country`/`os_platform`/`days_since_last_active`).
   All other catalog games → no per-user table → enrichment disabled. Same coverage gap as
   [[game-integration-raw-table-taxonomy]].
- **Bulk-materialization caveat:** `user_profile` is designed for single-user `user_id = X` sub-second lookups.
  Materializing the projection for up to 1M members is a bulk `user_id IN (…)` against `mf_users` — different
  perf profile; validate cost before promising on large cohorts.

## Phase 3 — Pull endpoints (backend)
**Files:** `server/src/routes/segment-snapshot.ts` (new)

> **SHIPPED (260605) — bare member-ID slice.** `GET /api/segments/:id/members?cursor=&limit=`
> serves identity values only (keyset over sorted+deduped uid list, `limit` default 1000 / max 10000),
> returns `{segment_id, game_id, cube, computed_at, total_count, returned_count, truncated, members, next_cursor}`.
> Reuses `guardSegment('read')`; `truncated = uid_count > stored`. `server/src/routes/segments.ts` +
> `server/test/segment-members-pull.test.ts` (6 cases). Enrichment/projection, file export, snapshot
> versioning still pending (below).

- `GET /api/segments/:id/snapshot[/:version]` → metadata (version, freshness, counts, truncated, schema, identity).
- `GET /api/segments/:id/snapshot/:version/members?cursor=&limit=` → **keyset** pagination (not offset), fields = projection.
- `GET /api/segments/:id/snapshot/:version/export.parquet` → presigned-style file download; large cohorts async
  (`POST …/export` → job → `GET …/exports/:jobId` returns URL when ready).
- Default-deny via existing `guardSegment(... 'read')`; version pin keeps a mid-pull consumer stable.

## Phase 4 — Frontend "Pull API" tab (replace activation mock)
**Files:** `src/pages/Segments/detail/tabs/activation-tab.tsx` → rewrite as `pull-api-tab.tsx`,
`src/pages/Segments/detail/use-active-tab.ts` (relabel), `src/pages/Segments/segments.module.css`

- Per prototype: snapshot status card (version + freshness + counts + identity badge), truncation warning,
  projection picker (QB pill hues), schema preview, copy-able pull endpoints, PII note.
- Keep route id `activation` internally to preserve deep-links; label → "Pull API". Remove push-modal CTA path.
- Strict design tokens (`tokens.css`), Inter, page-header pattern. No raw hex.

## Phase 5 — Security hardening (the GA gates)
**Files:** auth/access-store, new audit hook, rate-limit middleware

- **Export grant**: new feature bit `export_segments` (don't silently reuse `visibility=shared` for raw-ID export).
- **Per-pull audit**: log actor + segment + version + row count on every members/export call (extend `activity_events`).
- **Rate limit** on snapshot/export routes (none today).
- Decision needed: does `env=prod` gate harder than dev (extra grant / approval)?

---

## API contract (snapshot metadata)
```jsonc
{ "segment_id":"…","version":5,"snapshot_id":"snp_…","definition_hash":"…",
  "computed_at":"…","data_through":"2026-06-03",
  "identity_type":"game_user_id","game_id":"tf","env":"prod",
  "total_count":412330,"returned_count":100000,"truncated":true,
  "schema":[{"field":"user_id","type":"string","kind":"identity"},…],
  "members_url":"…/snapshot/5/members?cursor=…","export_url":"…/snapshot/5/export.parquet" }
```

## Risks
- **Full-projection materialization** is heavier than today's per-page fetch → schedule + watch Trino load.
- **File storage**: prod is `playground.gds.vng.vn` — need a blob location (local disk vs object storage) for `.parquet`. Unknown.
- **1M cap** still truncates the largest cohorts — flag is the safety net, not a fix.
- Reusing `activation` route id avoids broken links but is a naming smell — document it.

## Open questions
1. Are player UIDs already PII-scrubbed upstream (game_integration), or raw IDs needing masking on export?
2. File export storage target on prod — local disk, or an S3/object store? (decides Phase 3 file path)
3. `export_segments` as a new grant bit, or reuse `visibility=shared`? (recommend new bit)
4. Does `env=prod` export need a harder gate than dev/stag?
5. Keep `activation` route id, or migrate to `pull-api` with a redirect?
