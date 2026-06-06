---
phase: 1
title: LTV-tiered member sampling (server)
status: completed
priority: P1
effort: 1d
dependencies: []
---

# Phase 1: LTV-tiered member sampling (server)

## Overview
At segment-refresh time, compute three LTV-ranked subgroups — top 50 / middle 50 / bottom 50 —
via ordered Cube queries scoped by the segment predicate, and persist them (uid + LTV value) on
the segment row. Replaces nothing yet; FE consumes in Phase 2, precompute in Phase 3.

## Requirements
- Functional: tiers computed for predicate segments whose preset declares an LTV measure;
  stored with per-uid LTV values; recomputed on every refresh (manual or cadence-driven).
- Non-functional: ≤3 extra Cube queries per refresh; physicalized members; graceful skip
  (no tiers ≠ broken segment).

## Architecture
- **Preset extension**: add optional `ltvMeasure?: string` + `ltvLabel?: string` to the hub
  preset spec (`server/src/presets/mf-users-hub.ts:63` type block). Set
  `ltvMeasure: 'mf_users.ltv_total_vnd'` on `mf-users-hub` and `etl-game-detail` presets.
  No preset / no measure → tiers skipped, FE falls back to current random sample.
- **Tier queries** (in `refresh-segment.ts`, after uid materialization, before card-runner):
  base query = `{ dimensions: [identityDim], measures: [ltvMeasure], filters: <segment predicate
  filters ANDed, same scoping as card-runner:103-126> }`, physicalized via `physicalizeQuery`.
  - top: `order {ltvMeasure: 'desc'}, limit 50`
  - bottom: `order {ltvMeasure: 'asc'}, limit 50` (zero-LTV users are legitimately "bottom")
  - middle: `order {ltvMeasure: 'desc'}, limit 50, offset max(0, floor(uid_count/2) - 25)`
    — uses `uid_count` from the just-completed size query.
- **Degenerate sizes**: if `uid_count <= 150`, run one query (`order desc`, no offset/limit
  beyond uid_count) and store as single tier `all`. Between 150 and 450, tiers may overlap —
  dedupe by priority top > bottom > middle; drop dupes from middle (then bottom). Store what
  remains; counts per tier may be <50, FE displays actual counts.
- **Storage**: new column `member_tiers_json TEXT` on `segments`
  (migration `server/src/db/migrations/032-segment-member-tiers.sql`). Shape:
  ```json
  { "computed_at": "...", "ltv_measure": "mf_users.ltv_total_vnd",
    "tiers": { "top": [{"uid":"…","ltv":123}], "middle": [...], "bottom": [...] } }
  ```
  (~150 rows ≈ a few KB — JSON column is the KISS choice over a child table.)
- **Manual segments**: refresh job already skips them (`refresh-segment.ts:76`) — no tiers v1;
  FE keeps random sample for manual segments. Documented limitation.

## Related Code Files
- Modify: `server/src/jobs/refresh-segment.ts` (tier computation step; extract to
  `server/src/services/member-tier-runner.ts` if it pushes the file past ~200 LOC)
- Modify: `server/src/presets/mf-users-hub.ts`, `server/src/presets/etl-game-detail.ts`
- Create: `server/src/db/migrations/032-segment-member-tiers.sql`
- Modify: `server/src/routes/segments.ts` (include `member_tiers` in GET `/api/segments/:id`)
- Modify: `server/src/types/segment.ts` + `src/types/segment-api.ts` (tier types)

## Implementation Steps
1. Migration 032: `ALTER TABLE segments ADD COLUMN member_tiers_json TEXT;`
2. Add `ltvMeasure` to preset type + both presets.
3. Implement `computeMemberTiers(segment, preset, prefix)` in
   `server/src/services/member-tier-runner.ts`: 3 ordered queries (1 for degenerate case),
   physicalized, 30s timeout each, returns tier object or `null` on any failure (log, don't
   fail the refresh).
4. Wire into `refreshSegment` after uid persistence; write `member_tiers_json` in the same
   transaction step as `uid_list_json`.
5. Serialize `member_tiers` (parsed) in segment GET; omit from list endpoint (heavy-ish).
6. Tests (server vitest): tier shape, degenerate ≤150, overlap dedupe 151–450, preset without
   ltvMeasure → null, query failure → refresh still succeeds, physicalization asserted on a
   prefix workspace fixture.

## Success Criteria
- [x] Refreshing a predicate mf_users segment yields 3×50 tiers with descending/ascending LTV
- [x] Segment with 80 members yields single `all` tier of 80
- [x] Preset without `ltvMeasure` → `member_tiers_json` stays NULL, refresh status unchanged
- [x] Tier query failure logged, refresh completes, segment not marked broken
- [x] All existing refresh tests still green (832/832 under node 24)

## Verification notes (260607)
- Per-user LTV semantics confirmed live: `dimensions:[mf_users.user_id], measures:[ltv_total_vnd],
  order desc` via gateway `/cube-api/v1/load` (game ballistar) → 205.1M / 167.1M / 166.9M VND.
- Code review DONE_WITH_CONCERNS → both resolved (node-24 suite run; live LTV probe above).
- Offset-window math reviewer-verified: rank windows never overlap for >150; dedupe guards
  LTV-tie edge cases only.
- Env note: better-sqlite3 was rebuilt for nvm node v24.11.1 (homebrew node 25 had clobbered
  the binary during a failed rebuild; server tests must run under node 24).

## Risk Assessment
- **Middle-offset instability**: Cube `offset` requires deterministic order; ties on LTV could
  shuffle between runs. Mitigation: secondary order by identityDim asc.
- **LTV measure semantics**: `ltv_total_vnd` aggregated per user_id = per-user LTV — verify with
  one manual Cube query during implementation (lessons-learned: validate Cube YAML assumptions).
