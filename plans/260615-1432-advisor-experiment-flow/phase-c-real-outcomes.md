# Phase C — Real treatment-vs-hold-out outcomes (cube-first)

> Activates the substance of `plans/260614-0018-experiment-command-center/` phases 1–3,
> simplified by the **cube-first** path: `billing_detail` + `billing_lifetime` cubes
> already exist locally for cfm + jus, so outcomes read through the semantic layer
> (no raw-Trino readers / DESCRIBE). Locked decisions (user, 2026-06-15):
> **SQLite** assignment store · **cfm_vn + jus_vn** (jus currency-normalized) ·
> **live verification this session** (real Drive → segment → freeze → screenshot).

## Faithful design
The monitor board's lifecycle (`draft → frozen → delivering → measuring → readout`)
maps to a real experiment: entering monitor with a segment + split + window **creates**
a draft experiment; "Confirm & freeze the groups" **assigns** (deterministic uid-level
split, frozen in SQLite); the scorecard queries `billing_detail` for each arm's real
post-assignment gross. `?illustrative=1` forces the demo bars (no-Cube hosts / demos).

## Data anchors (verified)
- Outcome: `billing_detail` cube → `cash_charged_gross` (sum), `txn_count_total` (sum)
  by `user_id` × `order_date` × `currency`. cfm A49 = VND-only; jus A70 = mixed USD+VND
  → group by `currency`, normalize USD→VND at a documented fixed rate (env override).
- Cohort uids: `segments.uid_list_json` (ranked by the segment's defining measure).
  Capped at `EXPERIMENT_COHORT_CAP` (default 20000) for a demoable POC; cap surfaced in
  the assign result.
- Cube run: `loadWithCtx(query, ctx, timeoutMs)`; `WorkspaceCtx = {cubeApiUrl, token}`.
- Conventions: `resolveGameScope` (`care/game-scope.ts`), global `enforceWriteRoles`,
  envelope `{error:{code,message}}`, in-process scorecard cache (mirror
  `routes/segment-cs-tickets.ts`).

## Build slices
| # | Slice | Files | Notes |
|---|-------|-------|-------|
| C1 | Schema + pure cores | `db/migrations/060-experiments.sql`, `experiments/deterministic-split.ts`, `experiments/scorecard-stats.ts` | both pure modules unit-tested first |
| C2 | Store + readers | `experiments/experiment-store.ts`, `experiments/experiment-outcome-reader.ts`, `experiments/experiment-types.ts` | store = better-sqlite3; reader = cube IN-list chunked + jus currency-normalize |
| C3 | Assignment + routes | `experiments/assignment-service.ts`, `routes/experiments.ts`, register in `index.ts` | freeze reads uid_list_json (capped) → split → persist arms; scorecard cached |
| C4 | Client + monitor wiring | `src/api/experiments.ts`, `src/pages/Advisor/command-center.tsx` | create on entry, assign on freeze, scorecard bars; `?illustrative=1` flag |
| C5 | Tests | server unit (split, stats, store, route) + guarded live integration | live test runs only when `LIVE_CUBE=1` + lane present |

## Tables (migration 060)
```
experiments(
  id TEXT PK, game_id TEXT, workspace TEXT, name TEXT, hypothesis TEXT,
  segment_id TEXT, status TEXT,             -- draft|running|completed|archived
  split_pct INTEGER, primary_metric TEXT,   -- 'gross_payment_rate' | 'sessions_per_week'
  window_days INTEGER, cohort_cap INTEGER,
  assigned_at TEXT, created_at TEXT, updated_at TEXT)
experiment_assignment(
  experiment_id TEXT, uid TEXT, arm TEXT,    -- 'treatment'|'control'
  PRIMARY KEY (experiment_id, uid))
-- index (experiment_id, arm)
```

## Stats (scorecard-stats.ts — pure, documented)
- Re-pay rate: two-proportion z-test → lift (pp), 95% CI, p-value.
- Mean gross/user: mean + 95% normal-approx CI per arm; lift = treatment-control.
- ITT (assigned arms) is primary; exposure/ToT deferred (CS work-queue not wired).

## Currency (jus)
`EXPERIMENT_USD_TO_VND` (default 25000). Outcome reader groups by currency, multiplies
USD gross by the rate, sums to VND. cfm rows are VND → identity.

## Out of scope this round
- Lakehouse assignment log (SQLite chosen), CS work-queue / exposure / treated-on-treated,
  `/work-queue` + `/members/:uid` endpoints, the experiment-360 home.

## Live verification (2026-06-15)
Ran end-to-end on the running dev backend (:3004) against the live `billing_detail`
cube (:4000), segment "Risk whale last 30d" (344 real cfm_vn uids):
- **Freeze** split the 344 real uids → 178 treatment / 166 control (deterministic, ~50/50).
- **Scorecard** (backdated `assigned_at` to a billing-rich window so the forward
  window captured real history) returned REAL per-arm gross from the cube in ~15s:
  treatment 23 payers / 49.5M₫, control 24 payers / 49.1M₫, currencies `["VND"]`,
  verdict **flat** (repay 12.9% vs 14.5%, p=0.68) — the correct unbiased result for
  an *untreated* random split (an A/A sanity check that the split isn't skewed).
- **Continue-wait fix:** a cold `billing_detail` uid-filtered scan exceeds 15s and
  returns Cube's "Continue wait"; the reader now polls via `loadWithContinueWait`
  (90s budget) instead of a single-shot 30s `loadWithCtx`, or the scorecard 502s cold.
- **propose_cohort live agent behaviour:** covered by host-gated test
  `experiment-propose-cohort-live.test.ts` (skips without an OAuth token; runs on the
  token-bearing host). The pick-existing fallback guarantees no dead-end regardless.
- **Screenshots:** `visuals/monitor-01..04*.png` capture the linear flow through the
  real UI (goal → board → decide/review) on the whale segment. The final monitor-board
  PIXELS were not auto-captured: reaching `command` requires either the manual builder's
  per-card investigate→keep-lever interaction (flaky to script) or the Drive path (OAuth
  token absent in this shell). The monitor's real-data RENDERING is verified by the route
  integration test (create→assign→scorecard) + the live API run above — not by a pixel.

## Live verification (2026-06-17) — monitor-board pixel + auto-create reliability
Closed the open pixel item and stress-tested the auto-create path on the running
dev stack (backend :3004, live `billing_detail` cube :4000, FE :3000, subscription
OAuth lane):
- **Agent → propose_cohort (host-gated live vitest): PASS.** Real Drive turn on the
  OAuth+Cube lane (`claude-sonnet-4-6`, $0.36, 123s) ran
  `diagnose → cube_query → propose_cohort → predicate_compile ×5 → propose_cohort`,
  `end_turn`, and persisted a cohort whose predicate compiles (≠ `1=1`).
- **Segment actually created (this session): PASS.** A fresh predicate segment
  ("Win-back lapsed whales") materialized **369 real cfm_vn uids** from the live
  cube; experiment frozen → **treatment 199 / hold-out 170** (deterministic split).
- **Monitor-board pixels captured (the previously-open item):**
  `visuals/monitor-board-live-frozen.png` (fresh freeze, forward window → honest
  0% / flat, no post-assignment billing yet) and
  `visuals/monitor-board-live-real-gross.png` (window backdated to a billing-rich
  period → **real per-arm repay 15.56% vs 13.7%** from `billing_detail`, "+2/100 but
  inside the noise band" — the correct A/A result for an untreated random split).
- **Auto-create reliability is VARIABLE (real finding).** A second live Drive
  (same prompt, via the running backend) **timed out at 240s** after the model
  wandered to a non-existent cube (`pmt_user_daily`) and then fought the predicate
  schema for 8 tool calls. Root cause of the death-spiral: `predicate_compile`
  surfaced an opaque `Cannot read properties of undefined (reading 'length')` from
  `predicateToSql` (a malformed-node TypeError) instead of an actionable message,
  so the agent couldn't self-correct and exhausted its budget right after a compile
  finally passed. **Fix:** hardened `predicateToSql` to reject malformed nodes
  (missing `kind` / missing `children` array / non-object) with descriptive errors
  + 4 regression tests. The pick-existing fallback already guarantees no dead-end
  regardless; this fix should reduce the auto-create timeout rate.

## Success criteria
- Pure modules: split deterministic + within ±2pp of split over 1000 uids; z-test/CI match
  hand-computed fixtures.
- `POST /api/experiments` → draft; `POST :id/assign` → frozen arms (idempotent, capped);
  `GET :id/scorecard` → real per-arm gross from billing_detail, cached.
- Monitor board shows real treatment-vs-hold-out numbers; `?illustrative=1` forces demo.
- No PII columns selected (only user_id + numeric metrics).
- Live: a real Drive proposes a cohort → segment created → experiment frozen → monitoring
  screenshot captured.
