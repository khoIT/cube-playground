# Phase 02 — Experiment Registry + Assignment Service

## Context links
- Report §4.3 items 1–2, §4.5 (Statsig parallels).
- SQLite store template: `server/src/care/care-case-store.ts` + migration `server/src/db/migrations/037-care-cases.sql`.
- Migration runner: `server/src/db/sqlite.ts` (PRAGMA user_version = file count; additive forward-only). Latest = `051`.
- Assignment-log template: `server/src/lakehouse/segment-snapshot-writer.ts` + `segment-membership-ddl.sql` + `lakehouse-trino-connector.ts`.
- Cohort source: Phase 1 `payer-cohort-reader.ts`.

## Overview
- **Priority:** P0.
- **Status:** pending.
- Two pieces: (a) experiment metadata in SQLite (registry), (b) deterministic hash-split assignment over a cohort, with an immutable assignment log landed in `stag_iceberg.khoitn`.

## Key insights
- Registry = small SQLite table, mirrors `care_cases` store shape (TEXT id, timestamps, status lifecycle). DRY: reuse `getDb()`.
- Assignment must be STABLE across the experiment window. Deterministic = `hash(experimentId + ':' + uid) mod 100 < splitPct → treatment`. No RNG, no stored-per-uid bucket needed for recompute — but we DO persist the assignment log (immutable record of who-was-in-which-arm at assignment time) because the cohort snapshot can drift.
- Assignment log goes to the lakehouse (parallel to `segment_membership_daily`) so it survives and is queryable cross-arm at scorecard time. Reuse the `ensureLakehouseTables` DDL-file pattern.
- KISS: assignment is a one-shot "freeze" action triggered when an experiment goes from `draft` → `running`, not a nightly job. POC has one experiment.

## Requirements
Functional:
1. SQLite `experiments` table: id, game_id, workspace, name, hypothesis, status (`draft|running|completed|archived`), cohort params (ltv_floor_vnd, lapse_min_days, lapse_max_days), split_pct, primary_metric, assigned_at, window_days, created/updated.
2. `experiment-store.ts`: CRUD (create, get, list, patchStatus, listByGame).
3. `assignment-service.ts`: `assignExperiment(experimentId)` — pull cohort (Phase 1 reader), deterministic split, write immutable rows to lakehouse `experiment_assignment`, set `assigned_at` + status `running`. Idempotent: re-running a `running` experiment is a no-op (assignment frozen).
4. `experiment-assignment-reader.ts`: read back arm membership (uid → arm) for an experiment from the lakehouse.

Non-functional: hash = stable, fast (FNV-1a or `crypto.createHash('sha256')` truncated — pick one, document). Lakehouse write idempotent per experiment_id (DELETE-then-INSERT slice, like snapshot writer).

## Data flow
```
draft experiment (SQLite) + cohort params → assignExperiment():
  payer-cohort-reader → uid[]
  → deterministicArm(experimentId, uid) → {uid, arm}[]
  → DELETE+INSERT into stag_iceberg.khoitn.experiment_assignment (frozen log)
  → SQLite: status=running, assigned_at=now
```

## Related code files
Create:
- `server/src/db/migrations/052-experiments.sql`
- `server/src/experiments/experiment-store.ts`
- `server/src/experiments/assignment-service.ts`
- `server/src/experiments/deterministic-split.ts` (pure, unit-testable)
- `server/src/lakehouse/experiment-assignment-ddl.sql`
- `server/src/lakehouse/experiment-assignment-reader.ts`
- extend `lakehouse-trino-connector.ts`: add `EXPERIMENT_ASSIGNMENT = qualifiedLakehouseTable('experiment_assignment')` + an `ensureExperimentTables(connector)` (or fold into existing `ensureLakehouseTables` — prefer a separate fn to keep segment DDL isolated).

Read for context: `care-case-store.ts`, `segment-snapshot-writer.ts`, `037-care-cases.sql`, `sqlite.ts`.

## Implementation steps
1. `052-experiments.sql` — `CREATE TABLE IF NOT EXISTS experiments (...)`, indexes on `(game_id)`, `(status)`. Additive, forward-only (matches runner contract).
2. `experiment-assignment-ddl.sql` — `experiment_assignment(experiment_id VARCHAR, game_id VARCHAR, uid VARCHAR, arm VARCHAR, assigned_at DATE)` partitioned by `experiment_id` (point reads dominate). Mirror `segment-membership-ddl.sql` placeholder-token style.
3. `deterministic-split.ts` — `armFor(experimentId, uid, splitPct): ExperimentArm`. Pure fn, no I/O.
4. `experiment-store.ts` — better-sqlite3 prepared statements; `clearExperiments()` test hook (mirror `clearCases`).
5. `assignment-service.ts` — orchestrate cohort pull → split → `ensureExperimentTables` → DELETE slice → INSERT (chunked) → SQLite status patch. Structured result `{experimentId, treatment, control, total}`. Guard: only assign a `draft`; if already `running`, return existing counts (idempotent).
6. `experiment-assignment-reader.ts` — `armMembers(experimentId)` → `{uid, arm}[]`; `armUids(experimentId, arm)` → `uid[]`.
7. Compile check.

## Todo
- [ ] `052-experiments.sql`
- [ ] `experiment-assignment-ddl.sql`
- [ ] `deterministic-split.ts` (pure)
- [ ] `experiment-store.ts` (+ clear hook)
- [ ] `assignment-service.ts` (idempotent freeze)
- [ ] `experiment-assignment-reader.ts`
- [ ] `lakehouse-trino-connector.ts` extension
- [ ] compile clean

## Success criteria
- `armFor` deterministic: same inputs → same arm across calls/process restarts; split ratio within ±2pp of `splitPct` over a 1000-uid cohort (unit test).
- `assignExperiment` lands rows in the lakehouse; re-run is a no-op (same counts, no duplicate rows).
- `experiment-assignment-reader` round-trips the written arms.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Cohort drift between assign and scorecard | M×M | Freeze: assignment log is the source of truth for arms, NOT a live cohort re-query. Scorecard reads the frozen log. |
| Non-atomic lakehouse DELETE+INSERT (Iceberg REST) | L×M | Same self-correcting behavior as snapshot writer; assign is manual one-shot, re-runnable. Document. |
| Migration numbering collision (parallel sessions) | L×M | Confirm latest at implement time; `ls migrations | tail -1` before naming. |
| Hash skews on small cohort | L×L | POC cohort is hundreds+; ±2pp tolerance acceptable; report exact counts in assign result. |

## Security (PII)
- Assignment log stores `uid` + `arm` only. No metrics, no PII. Registry stores params, not member data.

## Next steps
Phase 3 exposes assign + read over HTTP; Phase 5 scorecard reads the frozen arms.
