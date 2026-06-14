# Phase 1 · Care-Case Ledger + Trigger / Watched-Metric Engine (backend)

**Priority:** high — backbone of all surfaces.
**Status:** ✅ done (ledger + engine + sweep + routes + tests). Live cron scheduling & per-member ratio trigger-eval deferred to integration (sweep driver built + unit-tested via injection). Review fix applied: PATCH route now behind the editor/admin write-role gate. Open Phase-5 item: `condition_lapsed` un-flag path. **Gates:** blockedBy Phase 0.

## Overview
Add the **stateful primitive** the read-only grid lacks: one `care_cases` row per (user × playbook × occurrence), opened by the refresh worker via membership-diff or per-member trigger eval, with the stats snapshot that fired it and a status lifecycle. Reuses the existing Segments refresh worker + predicate→Cube path.

## Data model (new migration)
```sql
CREATE TABLE care_cases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL, workspace TEXT NOT NULL,
  playbook_id TEXT NOT NULL,            -- registry id "04"
  uid TEXT NOT NULL,
  source TEXT NOT NULL,                 -- 'membership' | 'trigger'
  opened_at DATETIME NOT NULL,
  stats_snapshot_json TEXT,             -- deciding stats AT MATCH TIME
  status TEXT NOT NULL DEFAULT 'new',   -- new|in_review|treated|resolved|dismissed
  assignee TEXT, treated_at DATETIME, channel_used TEXT, action_taken TEXT, notes TEXT,
  kpi_target TEXT, kpi_eval_at DATETIME, outcome TEXT,  -- kpi_met|kpi_missed|na
  closed_at DATETIME, updated_at DATETIME NOT NULL
);
CREATE UNIQUE INDEX ux_open_case ON care_cases(game_id,playbook_id,uid) WHERE status NOT IN ('resolved','dismissed');
```
Also: `segments.watched_metrics_json` (already-modelled watched metrics, optional) — reuse the segment row a playbook resolves to, or store playbook→segment binding in registry.

## Engine (extends segment refresh worker)
Per playbook (resolved `available`), on cadence:
- **Membership playbooks** (02, 14, 18, …): recompute cohort UID list (existing path) → diff vs previous snapshot. `entered = current − previous` → **open case** (idempotent via unique index). `exited` → resolve/keep per open-Q.
- **Trigger playbooks** (03 spike, 04 drop, 12 gacha): per-member rule eval (bounded query) → open case on cross.
- On open: snapshot watched + deciding stats into `stats_snapshot_json`.

## Related files
- Create: `server/src/db/migrations/0XX-care-cases.sql`, `server/src/care/case-store.ts`, `server/src/care/case-engine.ts` (diff + trigger eval), `server/src/routes/care-cases.ts`.
- Modify: the segment refresh worker (add per-playbook case emission); `server/src/services/translator.ts` reuse.
- Read: `server/src/routes/segments.ts` (refresh enqueue/drain), `server/src/services/predicate-to-sql.ts`.

## API
`GET /api/care/cases?game&playbook&status` · `GET /api/care/cases/by-vip?game` (grouped) · `PATCH /api/care/cases/:id` (status/assignee/treatment) · `GET /api/care/cases/vip/:uid` (cross-playbook history).

## Implementation steps
1. Migration + `case-store.ts` CRUD with idempotent open (unique partial index).
2. `case-engine.ts`: membership diff (set difference on uid lists) + per-member trigger eval; stats snapshot on open.
3. Hook engine into refresh worker per resolved-available playbook.
4. Case routes incl. `by-vip` aggregation.
5. Tests: idempotent open (re-refresh while still matched → no dup), enter/exit transitions, trigger fire, snapshot persisted.

## Todo
- [ ] Migration + case-store + unique-open index
- [ ] Membership-diff + trigger-eval engine + snapshot
- [ ] Worker integration
- [ ] Case routes (list / by-vip / patch / vip-history)
- [ ] Tests (idempotency, transitions, snapshot)

## Success criteria
- Two consecutive refreshes of a stable cohort produce **one** case per member (no dup).
- A member crossing 04 spend-drop opens a `new` case with snapshot `7d/30d` values.
- `by-vip` returns multi-playbook grouping for users matching >1 playbook.

## Risks
- Trigger eval on raw cfm cubes must be per-member+bounded-date (never cohort scan) — enforce in engine; cohort-scale cfm NHÓM-2 waits for Phase-4 mart.
- exited-before-treatment handling = open Q #4; default keep-open + flag `condition_lapsed`.
