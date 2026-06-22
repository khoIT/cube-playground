# Segment UX: pre-confirm size + multi-measure predicates + editing

Make the chat agent "truly support" segment work. Three gaps confirmed by scout; infra mostly exists.

## Why these three
User picked (1) pre-confirm size, (2) multi-measure predicates, (3) segment editing — the product-shaped gaps. Cheap wins (get_time_coverage, segmentable-dimensions discovery) deferred.

## Feasibility (scouted)
- `server/src/services/predicate-to-sql.ts` already turns a predicate tree → SQL WHERE, incl. AND/OR groups + percentile subqueries. Measure bounds are **column compares on the per-user grain** (`mf_users.ltv_vnd >= X`), so multi-measure is already SQL-expressible.
- `server/src/lakehouse/segment-overlap-counts.ts` shows the `SELECT count(*) FROM <members>` pattern + Trino connector — a dry-run count reuses this.
- `PATCH /api/segments/:id` (`server/src/routes/segments.ts:768`) already accepts `predicate_tree` (owner/admin, triggers auto-refresh); `get_segment` (chat-service) already returns the tree.

## Phases
| # | Phase | Service | Status |
|---|-------|---------|--------|
| 01 | Server dry-run count endpoint | server | done |
| 02 | Wire pre-confirm size into propose_segment | chat-service | done |
| 03 | Multi-measure predicate authoring | chat-service | done (via existing `additional_filters` — no new schema; added skill 2-bound guidance + proof test) |
| 04 | Segment-edit tool + edit proposal | chat-service | done (`propose_segment_edit` + edit-intent routing; emits `segment_proposal` with an `edit` block) |
| 05 | FE cards (count display, edit card) + docs/lessons | src + docs | done (edit branch in shared SegmentProposalCard → PATCH; lessons + surface-map updated) |

## Key risks
- Trino count latency on billion-row cubes — count must be timeout-bounded + best-effort (proposal still emits if count times out). Count against the per-user pre-agg source (mf_users grain), never the raw event mart.
- Multi-measure only valid when both measures are **column-grade** (per-user). Aggregate measures needing GROUP BY are out of scope — gate on the catalog entry shape.
- PATCH predicate_tree triggers auto-refresh + is owner/admin-only — edit proposal must respect `canAdministerSegment` and surface that to the user.

## Dependencies
02 needs 01. 03 independent (chat-service only). 04 needs nothing new server-side. 05 after 02+04.

See phase files for detail.
