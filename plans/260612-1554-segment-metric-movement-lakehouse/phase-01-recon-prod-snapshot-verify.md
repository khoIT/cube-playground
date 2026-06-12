---
phase: 1
title: Recon — prod snapshot verify + ops visibility
status: completed
priority: P1
effort: 2h
dependencies: []
---

# Phase 1: Recon — prod snapshot verify + ops visibility

## Overview
Confirm the existing nightly membership snapshot actually runs in prod (it's env-gated), verify partitions are landing in `stag_iceberg.khoitn`, and surface the heartbeat log in the UI so silent failure is visible.

## Key Insights
- Job only executes when `SEGMENT_SNAPSHOT_ENABLED=true` on exactly ONE instance (`server/src/jobs/snapshot-segment-membership.ts:41`). Multi-instance guard is env discipline, not a lock.
- Heartbeat lives in SQLite `segment_snapshot_log` (per-segment status + `__started__`/`__delta__` sentinels) — prod has no server-log access, so the UI surface is the only practical observability.
- Local server CAN read shared Trino (`lakehouseConnectorFromEnv` reads `cube-dev/.env`) — partition verification works from a dev machine without prod access.

## Requirements
- Functional: prod snapshot state known (enabled? which instance? landing daily?); snapshot run log visible in the segment-refresh ops surface.
- Non-functional: read-only Trino verification queries; no new write paths.

## Related Code Files
- Read: `server/src/jobs/snapshot-segment-membership.ts`, `server/src/lakehouse/lakehouse-trino-connector.ts`
- Modify: `server/src/routes/` (small GET for `segment_snapshot_log`), segment-refresh ops console FE (add snapshot-run section — see `plans/260610-1923-segment-refresh-ops-console` for the existing tab)
- Prod env: Vault `jupyter/prod/khoitn/cube-playground` (see `docs/deployment-guide.md` / cube-playground-prod-vault-deploy memory)

## Implementation Steps
1. Check prod env: is `SEGMENT_SNAPSHOT_ENABLED=true` set in the Vault-synced prod env? If not, enable on the single prod instance via the CI sync→vault→deploy flow.
2. Verify landings from local via Trino (read-only): `SELECT snapshot_date, game_id, count(distinct segment_id), count(*) FROM stag_iceberg.khoitn.segment_membership_daily GROUP BY 1,2 ORDER BY 1 DESC LIMIT 30` + same for `_delta`. Record latest date, games covered, row counts.
3. Add `GET /api/segments/snapshot-runs` (admin/can_administer-gated): last N days of `segment_snapshot_log` grouped per run (date, written/skipped/errored counts, delta status, per-segment errors).
4. FE: snapshot-runs section in the segment-refresh ops tab (table: date, totals, expandable errors). Reuse existing ops-tab styling/tokens.
5. Document enable-state + instance in `docs/deployment-guide.md` (one paragraph).

## Success Criteria
- [x] Prod `SEGMENT_SNAPSHOT_ENABLED` state confirmed and recorded (key ABSENT from prod Vault → nightly dormant; deployment-guide manifest row added). **Enabling on exactly one prod instance = outstanding user action** — partitions bridged by manual runs meanwhile
- [x] Trino shows partitions for ≥2 games (cfm_vn + jus_vn, 17 segments; 2026-06-10 and 2026-06-12 via manual runs)
- [x] Ops tab lists snapshot runs with error visibility (snapshot-runs-section + per-error rows + definitions column)
- [x] No second instance can double-write (env audit: flag enabled nowhere in prod; design gates on exactly-one-instance env flag)

## Risk Assessment
- Prod env not enabled yet → first snapshot date = enable date; metric movement history starts then. Communicate: history accrues only forward (predicates aren't time-travelable).
- SQLite log is per-instance: if prod runs the job, the LOCAL ops tab won't see prod's log. Mitigation: the Trino partition query (step 2) doubles as the cross-instance source of truth — show "latest landed snapshot_date" from Trino in the same UI section.
