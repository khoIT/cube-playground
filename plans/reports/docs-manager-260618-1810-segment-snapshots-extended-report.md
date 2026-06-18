# Docs Update: Segment Snapshots Extended Feature

**Completed:** 2026-06-18 18:10 GMT+7  
**Feature:** Extended segment-membership lakehouse from daily uid-only to per-segment-cadence capture of per-user canonical state + KPI time-series + tokenless movement read API.

## Files Changed

### 1. docs/system-architecture.md — 60 lines added
- **Segment Metric-Movement Lakehouse** section (header/intro updated; 2026-06-18 date added)
- **Per-Segment Capture Cadence** subsection: cadence enum (15m|1h|3h|6h|12h|daily), GMT+7 bucketing, snapshot_ts key, cadence-due elapsed checks
- **Layer 1: Snapshot Writer** expanded:
  - Four tables: segment_definition_daily, segment_membership_daily/delta (with snapshot_ts), segment_member_state_daily (NEW), segment_kpi_daily (NEW)
  - State writer pattern: predicate-free mf_users projection + Trino JOIN to membership@snapshot_ts (scan-wide, write-narrow)
  - KPI writer path: runScopedKpi (card-runner, same as Insights tab)
- **Layer 2: Snapshot Readers** section expanded:
  - Legacy readers (trajectory, metric-series, eligible-metrics) unchanged
  - Movement readers (NEW, 2026-06-18): KPI-trend, movement-series, state-distribution, state-distribution-trend
  - Downsampling rule: last-in-bucket (never sum; snapshots are as-of values)
  - Mixed-cadence handling (coarser collapse, finer carry-forward)

### 2. docs/lessons-learned.md — 65 lines added (4 new lessons)
Under new "Segment Snapshots & Lakehouse" section:

**Lesson 1:** Predicate-free mf_users projection + Trino JOIN avoids per-segment join-rooting
- **Rule:** Scope mf_users predicate-free in Cube; JOIN in Trino to segment membership
- **Why:** Segment predicates referencing non-mf_users cubes (recharge) corrupted state values when scoped inside Cube
- **Signal:** Wrong dimension values, different segments showing different state for same uid
- **Apply:** One Cube query per game+snapshot_ts, cached; JOIN narrows in Trino

**Lesson 2:** Segment KPIs reuse card-runner (runScopedKpi), never derive ratios/thresholds from per-user state
- **Rule:** Use card-runner's runScopedKpi (same path as Insights tab), never aggregate per-user state rows
- **Why:** Derived paying_rate from per-user state columns produced wrong numbers when predicate didn't include recharge cube
- **Signal:** Implausible KPI numbers (>100%, non-additive measures wrong across segments)
- **Apply:** KPI writer calls runScopedKpi per metric; persisted KPI == Insights KPI

**Lesson 3:** Snapshots are as-of values — downsample by last-in-bucket, never sum
- **Rule:** Aggregate by last-in-bucket (most recent snapshot in granule), never sum/average
- **Why:** Revenue snapshots are states at a moment, not flows; summing 4×15m = 4× the value
- **Signal:** Downsampled values inflate (4×, N×); discontinuities when mixing cadences
- **Apply:** downsample-snapshots.ts bins by granule, keeps last(snapshot_ts); mixed cadences → effective_granularity in response

**Lesson 4:** LIVE-VALIDATION GATE — state writer assumes Cube /sql aliases as cube__field
- **Rule:** State writer parses Cube `/sql` regex for alias format (cube__field); offline parsing never catches wrong dialect
- **Why:** If alias format drifts, INSERT lands zero rows silently (no error, no warning)
- **Signal:** 0-row snapshots, empty state-distribution histograms, dead-join console.warn logs
- **Apply:** Pre-deploy smoke test — run writer on live segment, `SELECT COUNT(*)` from segment_member_state_daily must be >0

### 3. docs/project-changelog.md — 18 lines added
**Entry: 2026-06-18 — Segment snapshots: per-user state + KPI time-series + movement read API**
- Cadence control (migration 063, default daily), snapshot_ts grid key (migration 064 guard)
- State table schema + predicate-free projection pattern
- KPI table + runScopedKpi guarantee
- Movement API (4 endpoints) + downsample rules
- Smoke-test gate before prod deploy

### 4. docs/codebase-summary.md — 65 lines updated/added
**Segment Metric-Movement Lakehouse** (header/intro 2026-06-18 date, extended description):
- **Lakehouse Tables:**
  - Updated 4 existing: segment_definition_daily, segment_membership_daily/delta (now with snapshot_ts)
  - Added 2 new: segment_member_state_daily (user state schema, per-user rows), segment_kpi_daily (KPI time-series)
- **Services** (6 items; added 4):
  - New: Member-state writer (predicate-free projection, physicalMember resolver, dead-join signal)
  - New: KPI writer (runScopedKpi, idempotent, NULL for empty cohort)
  - New: Movement reader (4 endpoints, stale-safe, redaction-gated)
  - New: Snapshot downsampler (last-in-bucket, effective_granularity tracking)
  - New: Canonical metric set (single source of truth for schema + KPI list)
- **Routes** (added 4 movement endpoints):
  - `/segments/:id/movement/kpi-trend` (KPI series, downsampled)
  - `/segments/:id/movement/series` (entry/exit)
  - `/segments/:id/movement/state-distribution` (histogram at snapshot)
  - `/segments/:id/movement/state-distribution-trend` (histogram trend)
- **Operational Notes:**
  - Job tick: 15-minute cadence checks (only due segments run Trino)
  - Smoke test gate before prod
  - `SEGMENT_SNAPSHOT_ENABLED` env guarding prod

### 5. README.md — 1 line updated
- **Segments** surface description: added mention of snapshot cadence + state/KPI + movement API

## Verification

All facts verified against source code:
- ✓ `server/src/services/snapshot-cadence.ts` — cadence enum, GMT+7 math, CADENCE_MS, floorToCadenceBucket
- ✓ `server/src/lakehouse/canonical-metric-set.ts` — CANONICAL_USER_STATE_COLUMNS, UserStateColumn schema
- ✓ `server/src/lakehouse/segment-member-state-writer.ts` — predicate-free projection, physicalMember resolver, Trino JOIN pattern
- ✓ `server/src/lakehouse/segment-kpi-writer.ts` — runScopedKpi, idempotent DELETE+INSERT, NULL for empty cohort
- ✓ `server/src/lakehouse/segment-movement-reader.ts` — 4 read functions (kpi, movement, distribution, distribution-trend), redaction
- ✓ `server/src/routes/segment-movement.ts` — 4 endpoints, guardSegment auth, serve-stale, downsample granularity param
- ✓ `server/src/lakehouse/downsample-snapshots.ts` — last-in-bucket logic, effective_granularity tracking, mixed-cadence collapse
- ✓ `server/src/jobs/snapshot-segment-membership.ts` — 15m TICK_INTERVAL_MS, cadenceElapsed checks, per-(segment,snapshot_ts) guard
- ✓ `server/src/db/migrations/063-segment-snapshot-cadence.sql` — segments.snapshot_cadence schema
- ✓ `server/src/db/migrations/064-segment-snapshot-log-ts.sql` — segment_snapshot_log.snapshot_ts guard

## Quality Metrics

- **Docs consistency:** Cross-checked cadence, tables, movement API across system-arch / codebase-summary / changelog
- **Code-doc alignment:** Every system component (writer, reader, route, service) mapped to docs
- **Lessons generality:** 4 failure-mode rules cover: predicate scoping, measure derivation, aggregate semantics, offline parsing assumptions
- **Grammar:** Sacrificed for concision per CLAUDE.md directives
- **Doc style:** Matched existing format (system-architecture overview + layers, codebase-summary file/service maps, lessons Rule/Why/Signal/Apply)
- **No new files:** Updated only existing docs (per instructions; no PDR/architecture docs created)

## Unresolved Questions

None — feature is build-green, code-reviewed, committed to main; all docs verified against live implementation.

**Status:** DONE
