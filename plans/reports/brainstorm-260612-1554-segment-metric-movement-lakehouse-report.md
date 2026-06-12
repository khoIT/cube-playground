# Brainstorm: Segment Metric-Movement Layer on Lakehouse Snapshots

Date: 2026-06-12 (GMT+7) | Participants: khoitn + Claude | Status: APPROVED → handed to /ck:plan

## Problem Statement

Bosses want experimentation-loop capability. Treatment sync-back from external team pending (separate follow-up). Low-hanging fruit now: infra to compute **metric movement of segments across time**. User initially proposed "daily snapshot of segments incl. member info fanout into stag_iceberg".

## Key Scout Finding (changes framing)

**Daily membership snapshot ALREADY EXISTS** (commit ac25dfc):
- `stag_iceberg.khoitn.segment_membership_daily` — (snapshot_date, game_id, segment_id, uid), full cohort (no MAX_UID_LIST cap), Iceberg/Parquet, partitioned (date, game, segment). DDL: `server/src/lakehouse/segment-membership-ddl.sql`
- `stag_iceberg.khoitn.segment_membership_delta` — entered/exited day-over-day feed
- Nightly job `server/src/jobs/snapshot-segment-membership.ts`: hourly tick, once/GMT+7-day guard, idempotent DELETE-partition→INSERT→count, heartbeat log in SQLite, gated `SEGMENT_SNAPSHOT_ENABLED=true` (single instance)
- Writers: `server/src/lakehouse/segment-snapshot-writer.ts`, `segment-delta-writer.ts`; connector `lakehouse-trino-connector.ts` (reuses trino-rest-client, CUBEJS_DB_* env)
- Covers all type='predicate' segments with cube + game mapped to Trino schema

## Decisions (agreed)

### D1 — Persist the non-recomputable, JOIN the immutable
- **Snapshot**: membership (exists) + **segment definitions** (NEW — mutable via editor shipped this week; history uninterpretable without it). `segment-definition-hash.ts` exists for hashing.
- **JOIN at read**: per-user metrics. Warehouse daily marts (user_recharge_daily, actives, mf_/cons_) already persist them immutably; copying = same bytes twice. uid×segment×metric×day grain ≈ 1.8B rows/yr for ONE 500k segment. REJECTED full member-info fanout.
- Surviving sliver: as-of-entry attributes (2-3 attrs, e.g. VIP tier at entry) on delta 'entered' rows only — Phase D.

### D2 — Cohort lenses are query-time constructs (user's in/out concern)
All three lenses served from existing tables, no new snapshot tables:
| Lens | Derivation | Note |
|---|---|---|
| Current members | membership@t | composition artifacts possible (whale exits → ARPU drop) |
| Entry cohort (closed) | delta entered≥anchor, tracked forever incl. after exit | experimentation-correct lens |
| Stayers | membership@anchor ∩ membership@t | user wants UI compare; MUST label survivor-bias |
UI: trajectory chart with lens switcher + anchor-date picker.

### D3 — Server-side Trino BEFORE Cube model
- Cohort lenses = self-intersection of membership at two dates parameterized by anchor — Cube cannot join a cube to itself at two filter values. Raw Trino via existing `trino-rest-client` pattern (profiler/snapshot/delta precedent).
- Cube earns place in Phase C: `segment_metrics` cube over materialized `segment_metric_daily` (fixed schema, additive, pre-aggregatable) for dashboards/chat.
- Cube stores nothing (semantic layer); storage is Trino either way — Phase C aggregate table is the only new persisted metric data.

### D4 — Compute: both, phased (query-time first, materialize hot path when proven slow)

## Phases

**A — Foundation hardening**
1. Verify/enable SEGMENT_SNAPSHOT_ENABLED on exactly one prod instance; confirm partitions landing; surface heartbeat log in admin hub.
2. NEW `stag_iceberg.khoitn.segment_definition_daily`: (snapshot_date, game_id, segment_id, definition_hash, name, cube, type, predicate_tree_json, cube_query_json). Written in same nightly run. "Definition changed" = hash != lag(hash).
3. **Mart scout (user-added requirement)**: scout daily marts per game in LOCAL workspace (`cube-dev/cube/model/cubes/{game}/`+ Trino information_schema) to determine which games have per-user daily-snapshot facts available (user_recharge_daily, active dailies, mf_users etc.) → per-game metric-movement eligibility matrix. Gate which metrics/games the trajectory layer offers.

**B — Metric movement query-time + first UI**
4. Zero-compute quick win: segment-detail "Trajectory" panel — size-over-time + entered/exited bars (pure counts on existing tables).
5. Server endpoint: Trino SQL joining membership/delta to fact marts by uid+date; params (segment, metric_key from catalog, lens, anchor_date).

**C — Materialize hot path (gated on B measurably slow)**
6. `segment_metric_daily` (snapshot_date, game_id, segment_id, metric_key, value, member_count) — CURRENT-members lens only, appended nightly. Cohort lenses stay query-time (partition-pruned intersections, cheap; per-anchor materialization = cardinality explosion). Optional `segment_metrics` Cube model on top.

**D — As-of-entry attributes**
7. Enrich delta 'entered' rows with 2-3 frozen-at-entry attrs.

**Side artifact (zero code)**: proposed `treatment_events` DDL (game_id, campaign_id, uid, variant, channel, treated_at) in same schema — contract for external team sync-back meeting.

## Risks

- Nightly Trino load: snapshots serial w/ 120s cap; Phase C multiplies by segments×metrics — keep gated.
- Fact-mart restatement/retention: if marts restate or purge, query-time history shifts/vanishes → Phase C doubles as freeze; ask data platform.
- Cube-only derived metrics: model edits change recomputed history → materialized agg captures value-as-computed.
- Survivor bias in stayers lens: label in UI, never headline.

## Success Criteria

- Per-game eligibility matrix produced (which games/metrics support movement).
- Segment detail shows size + entered/exited trajectory from lakehouse.
- Metric series endpoint returns 3 lenses with anchor param for ≥1 game (cfm_vn or jus_vn).
- Definition history reconstructable: every membership partition joinable to producing definition hash.

## Unresolved Questions

1. Are mf_/cons_ daily marts append-immutable? Retention window? (data platform team)
2. SEGMENT_SNAPSHOT_ENABLED currently on in prod? Which instance?
3. Which 2-3 as-of-entry attributes for Phase D? (defer to phase)
4. treatment_events: external team's campaign-id taxonomy unknown — contract proposal only.

## Strategic Context (for bosses)

Experimentation loop sequencing: this layer = measurement substrate. Decision/treatment data lands later via treatment_events. "AutoResearch for actionable segments" becomes a ranking problem only after experiments accumulate labeled outcomes — this infra is the prerequisite, not a sibling.
