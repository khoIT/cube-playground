---
phase: 4
title: Definition snapshot — segment_definition_daily
status: completed
priority: P1
effort: 4h
dependencies: []
---

# Phase 4: Definition snapshot — segment_definition_daily

## Overview
Land each eligible segment's definition (hash + predicate + query JSON + identity) daily into `stag_iceberg.khoitn.segment_definition_daily`, in the same nightly run as membership. Closes the interpretability hole: segments are editable, so without this, membership history can't be attributed to the definition that produced it ("metric moved" vs "definition changed" becomes unanswerable).

## Key Insights
- Hashing exists: `segmentDefinitionHash()` in `server/src/services/segment-definition-hash.ts:52` — canonicalized over (type, cube, game_id, predicate_tree); predicate segments ignore uid lists by design. Reuse as-is.
- Same idempotency pattern as membership writer: DELETE date partition slice → batch INSERT (`server/src/lakehouse/segment-snapshot-writer.ts:140-149`).
- Tiny data (one row per segment per day, ~dozens) — single multi-row `INSERT … VALUES` per day; partition by `snapshot_date` only.
- "Definition changed on day D" = `hash != lag(hash) OVER (PARTITION BY segment_id ORDER BY snapshot_date)` — no change-log table needed.
- Write definitions for ALL eligible segments BEFORE the membership loop — a segment whose membership INSERT errors still gets its definition row (history of what was *attempted*).

## Requirements
- Functional: one definition row per eligible segment per day; joins membership by (segment_id, snapshot_date); includes resolved identity field (records uid namespace per partition).
- Non-functional: idempotent per date; failure of definition write must not abort the membership loop (log + continue); JSON columns stored verbatim (VARCHAR).

## Architecture
Nightly run order: heartbeat sentinel → **definition write (all eligible, one statement)** → per-segment membership loop → delta. Definition writer reuses `lakehouseConnectorFromEnv()` + `runQuery` + `toSqlLiteral`.

## Related Code Files
- Create: `server/src/lakehouse/segment-definition-writer.ts`, `server/src/lakehouse/__tests__/segment-definition-writer.test.ts` (mirror existing snapshot-writer test patterns)
- Modify: `server/src/lakehouse/segment-membership-ddl.sql` (append CREATE TABLE), `server/src/jobs/snapshot-segment-membership.ts` (extend eligible-segments SELECT with name/type/predicate_tree_json; call definition writer; heartbeat row `__definitions__`)
- Read: `server/src/services/segment-definition-hash.ts`, `server/src/services/resolve-identity-field.ts`

## Implementation Steps
1. DDL: `segment_definition_daily(snapshot_date DATE, game_id VARCHAR, segment_id VARCHAR, definition_hash VARCHAR, name VARCHAR, cube VARCHAR, type VARCHAR, identity_field VARCHAR, predicate_tree_json VARCHAR, cube_query_json VARCHAR)` WITH (partitioning=ARRAY['snapshot_date'], format='PARQUET'). Append to `segment-membership-ddl.sql` (ensureLakehouseTables picks it up idempotently).
2. Extend `listSnapshotEligibleSegments()` query: add `name, type, predicate_tree_json` columns; widen `SegmentSnapshotInput` (or a superset type) accordingly.
3. `segment-definition-writer.ts`: `writeSegmentDefinitions(segments, snapshotDate, opts)` — compute hash per segment, resolve identity field (already resolved later per segment for membership; resolve once here and pass down to avoid double calls if convenient), DELETE date slice, single batched INSERT VALUES, post-count, structured result.
4. Wire into `runSegmentMembershipSnapshot` before the membership loop; heartbeat `__definitions__` row with rowCount/status.
5. Tests: hash stability (re-save same tree ⇒ same hash), idempotent re-run (DELETE+INSERT), malformed JSON tolerated, definition write failure doesn't abort run.
6. Manual verification against shared Trino: run once, confirm rows + lag(hash) change detection on an edited segment.

## Success Criteria
- [x] Run lands N definition rows where N = eligible segments (17, live-verified); visible in heartbeat (`__definitions__`, surfaced in admin payload + UI)
- [ ] Editing a segment's predicate produces a new hash the next day — NOT yet observed live (needs a real edit + next-day partition; hash fn is deterministic and pre-existing, mechanism verified by readback script)
- [x] Membership partitions joinable to producing definition by (segment_id, snapshot_date) — live readback verified
- [x] Definition-write failure logged, membership loop unaffected (never-throws writer contract, covered by tests)

## Risk Assessment
- Large predicate JSON in VARCHAR: predicate trees are small (<10KB); cap defensively (truncate-with-marker beyond 100KB, log).
- SQL injection via name/JSON literals → reuse `toSqlLiteral` (already escapes) — never string-concat raw.
- Identity resolution adds per-segment calls → batch once per run; on resolution failure store NULL identity_field rather than skipping the row.
