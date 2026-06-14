# Phase 2 — Sweep-Run Snapshot Store + Recording + Prune

## Context links
- Run-record template: `server/src/db/metric-drift-run-store.ts` + migration `server/src/db/migrations/022-metric-drift-run.sql`
- Sweep core: `server/src/care/care-case-sweep.ts` (`runCaseSweep` → `PlaybookSweepSummary[]`)
- Sweep route: `server/src/routes/care-cases.ts` POST `/api/care/cases/sweep`
- Prune template: `server/src/jobs/prune-activity-events.ts` (`ACTIVITY_RETENTION_DAYS`, tick fn, `startX` cron)
- Test harness: `server/test/resolve-identity-field-workspace.test.ts:17` (`makeMemDb`)

## Overview
- **Priority:** P2
- **Status:** pending
- Persist every sweep as a run: run-level metadata, per-playbook counts, per-uid membership. Add daily prune to bound membership growth.

## Key insights
- `runCaseSweep` already returns per-playbook `{playbookId, cohortSize, opened, lapsed, alreadyOpen, skipped?}` — run-level + per-playbook recording needs NO sweep-internals change; record from the route after it returns.
- Per-uid membership is NOT in the summary. Sweep computes `uids` per playbook internally (`care-case-sweep.ts:98-102`). Two options: (a) extend `PlaybookSweepSummary` with `uids: string[]`; (b) re-derive from open `care_cases` post-sweep. **Choose (a)** — sweep already holds the exact cohort uids; deriving from cases misses skipped/already-open distinctions. Add `uids?: string[]` to the summary (only for non-skipped playbooks).
- User accepts partial redundancy with `care_cases.opened_at`/`condition_lapsed` — honor the explicit membership snapshot decision; do not "optimize away" the membership table.
- Membership volume: ~23k uids/run/game × 4 runs/day → daily prune mandatory. Constants explicit.
- Migration count = 40 → use `041`, `042`, `043`. Naming `NNN-kebab-name.sql`. Bump implicit via file count.

## Requirements
- Functional: record one `care_sweep_runs` row per sweep (run_id, game, workspace_id, started_at, finished_at, source `'manual'|'cron'`, status `'ok'|'partial'|'error'`, opened_total, lapsed_total, profiles_refreshed). One `care_sweep_playbook_results` row per playbook per run (run_id, playbook_id, cohort_size, opened, lapsed, already_open, skipped). One `care_sweep_membership` row per (run_id, playbook_id, uid).
- Non-functional: recording best-effort — a record failure must NOT fail the sweep (sweep result still returned). Bulk-insert membership in a single transaction. Prune daily, log rows removed.
- Retention constants: `CARE_MEMBERSHIP_RETENTION_DAYS = 30`, `CARE_RUN_RETENTION_DAYS = 365` (per open Q1 default; user may override).

## Architecture
Schema (3 migrations, domain-slug names):
- `041-care-sweep-runs.sql`: `care_sweep_runs(run_id TEXT PK, game TEXT, workspace_id TEXT, source TEXT, status TEXT, started_at INTEGER, finished_at INTEGER, opened_total INTEGER, lapsed_total INTEGER, profiles_refreshed INTEGER)`; index `(game, started_at)`.
- `042-care-sweep-playbook-results.sql`: `care_sweep_playbook_results(run_id TEXT, playbook_id TEXT, cohort_size INTEGER, opened INTEGER, lapsed INTEGER, already_open INTEGER, skipped TEXT, PK(run_id, playbook_id), FK run_id→care_sweep_runs ON DELETE CASCADE)`; index `(playbook_id, run_id)` for trend.
- `043-care-sweep-membership.sql`: `care_sweep_membership(run_id TEXT, playbook_id TEXT, uid TEXT, PK(run_id, playbook_id, uid), FK run_id→care_sweep_runs ON DELETE CASCADE)`; index `(run_id, playbook_id)`.

Store `server/src/db/care-sweep-run-store.ts` (mirror drift-run-store): `recordSweepRun(input)`, `recordPlaybookResults(runId, summaries)`, `recordMembership(runId, perPlaybookUids)`, `listSweepRuns(game, limit)`, `getRun(runId)`, `pruneMembershipBefore(cutoffMs)`, `pruneRunsBefore(cutoffMs)`. (Read fns for trend/diff added/used in Phase 4.)

Prune job `server/src/jobs/prune-care-sweep-membership.ts` (mirror prune-activity-events): catch-up on boot + daily tick; delete membership older than `CARE_MEMBERSHIP_RETENTION_DAYS` (cascades not needed — membership pruned directly; runs pruned at the longer horizon, cascading their membership too). Log rows removed. Wired in Phase 3's index edit OR here via own `startCareSweepPrune()` (own startX, called in index — keep separate from auto-sweep cron).

Data flow (sweep route): existing sweep → on success build `perPlaybookUids` from summaries' `uids` → `recordSweepRun` → `recordPlaybookResults` → `recordMembership` (single txn) — all wrapped best-effort try/catch with `req.log.warn` on failure. Status `'partial'` if any summary `skipped:'query-failed'`, else `'ok'`.

## Related code files
- **Create:** `server/src/db/migrations/041-care-sweep-runs.sql`, `042-care-sweep-playbook-results.sql`, `043-care-sweep-membership.sql`.
- **Create:** `server/src/db/care-sweep-run-store.ts`.
- **Create:** `server/src/jobs/prune-care-sweep-membership.ts` (+ `startCareSweepPrune()`).
- **Modify:** `server/src/care/care-case-sweep.ts` (add `uids?: string[]` to `PlaybookSweepSummary`; populate for non-skipped playbooks only — already in scope at :98-102).
- **Modify:** `server/src/routes/care-cases.ts` (POST sweep: record run after summaries, best-effort; thread `source:'manual'`).
- **Modify:** `server/src/index.ts` (call `startCareSweepPrune()` near :231).
- **Delete:** none.

## Implementation steps
1. Write 3 migrations (domain slugs, FK CASCADE, indexes for trend/diff). Verify `makeMemDb()` execs them clean.
2. Extend `PlaybookSweepSummary` with `uids?: string[]`; populate at the non-skipped push (`care-case-sweep.ts:98-102`). Skipped pushes leave `uids` undefined.
3. Build `care-sweep-run-store.ts` with record + list + get + prune fns; membership insert in one prepared txn (chunk if >SQLite variable limit — insert row-by-row inside txn is fine, no multi-row VALUES needed).
4. Wire recording into POST sweep route (best-effort, after profiles block). Compute status. Generate `run_id` (e.g. `randomUUID`).
5. Write prune job + `startCareSweepPrune()`; constants `CARE_MEMBERSHIP_RETENTION_DAYS=30`, `CARE_RUN_RETENTION_DAYS=365`.
6. Wire prune startX in `index.ts`.
7. `npm run -w server build`; run new store + sweep-record tests.

## Todo
- [ ] 3 migrations created, exec clean in makeMemDb
- [ ] `uids` added to summary, populated non-skipped only
- [ ] care-sweep-run-store record/list/get/prune
- [ ] Sweep route records run best-effort
- [ ] Prune job + startX + index wiring
- [ ] Tests (record run/playbook/membership; prune horizon; sweep still succeeds when record throws)
- [ ] Build clean

## Success criteria
- After a manual sweep, exactly 1 run row, N playbook-result rows (N = swept playbooks incl skipped), membership rows = Σ cohort_size of non-skipped playbooks.
- Recording throwing does NOT fail the sweep HTTP response (test injects store error).
- Prune removes membership older than 30d, keeps runs 365d; logs counts.
- `PRAGMA user_version` aligns with new file count (43).

## Risk + mitigation
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Membership table unbounded growth | H×H | Daily prune w/ explicit constants; index on run_id; FK CASCADE |
| Recording slows the 2-min sweep | M×M | Single txn bulk insert; record after HTTP-critical work; best-effort |
| Migration count mismatch breaks user_version gate | L×H | Use 041/042/043; verify count=43 post-add; makeMemDb exec test |
| `uids` bloats summary returned to FE | L×L | `uids` server-internal; strip before HTTP response if FE doesn't need it |
| Redundancy w/ care_cases confuses future devs | L×L | Code comment: explain explicit membership snapshot is intentional (the why), no plan ref |

## Security
- Recording happens inside the already editor/admin-gated POST sweep path — no new public surface. New tables hold uids (PII-ish) — same trust boundary as `care_cases`. No new read route here (Phase 4 gates reads viewer-ok).

## Next steps
- Unblocks Phase 3 (cron records `source:'cron'` runs) and Phase 4 (trend/diff read off these tables).
