# Phase 4 — Diff/Trend API + FE Comparison Surface

## Context links
- Store (Phase 2): `server/src/db/care-sweep-run-store.ts` (add read fns here)
- Routes: `server/src/routes/care-cases.ts` (add GET trend/diff)
- Compare precedent: `server/src/db/metric-drift-run-store.ts` (`listDriftRuns`, compare-runs shape)
- Membership table: `care_sweep_membership` (entered/left via set diff between two runs)
- UI: `src/pages/Dashboards/cs/case-ledger.tsx` (LensToggle — add "Sweeps" lens), `use-care-cases.ts`
- Pager (Phase 1): `src/pages/Dashboards/cs/queue-pager.tsx` (reuse for drill-to-VIPs)
- Design: `docs/design-guidelines.md`

## Overview
- **Priority:** P2
- **Status:** pending — **depends on Phase 2** (reads snapshot tables; richer with Phase 3 data)
- Two views per user decision: (a) trend-over-time per playbook (cohort size across runs); (b) two-run comparison picker → per-playbook deltas + entered/left VIP counts + drill-to-VIPs.

## Key insights
- Trend = `SELECT playbook_id, run_id, started_at, cohort_size FROM care_sweep_playbook_results JOIN care_sweep_runs ... WHERE game=? ORDER BY started_at` — index `(playbook_id, run_id)` from Phase 2 supports it. Per-game (open Q2 default).
- Two-run diff per playbook: counts delta from `care_sweep_playbook_results` (cheap); entered/left VIP sets = set difference of `care_sweep_membership` uids between run A and run B for that playbook. Entered = B\A, Left = A\B. Compute in SQL (`EXCEPT`) or in-app (load two uid sets). Prefer SQL `EXCEPT` for count, paginate uids for drill.
- Membership may be pruned (30d) — if a selected run's membership is gone, diff degrades to counts-only. Surface "membership pruned" state, don't error.
- Drill-to-VIPs reuses pagination (50/page) + profile enrichment (`getVipProfiles`) like the queue.

## Requirements
- Functional:
  - `GET /api/care/sweeps/runs?game=&limit=` → run list (run_id, started_at, source, status, opened_total, lapsed_total) for picker.
  - `GET /api/care/sweeps/trend?game=&playbook=` (playbook optional → all) → per-playbook series `[{playbook_id, points:[{run_id, started_at, cohort_size}]}]`.
  - `GET /api/care/sweeps/diff?game=&runA=&runB=` → per-playbook `{playbook_id, cohortA, cohortB, openedDelta, enteredCount, leftCount, membershipAvailable}`.
  - `GET /api/care/sweeps/diff/vips?game=&runA=&runB=&playbook=&direction=entered|left&page=&pageSize=` → paginated uids (B\A or A\B) + profiles + `{total, page, pageSize}`.
- Non-functional: reads viewer-ok. Validate runA/runB belong to `game`. Degrade gracefully when membership pruned. pageSize clamp [1,200], default 50.

## Architecture
Store read fns (in `care-sweep-run-store.ts`): `listSweepRuns(game, limit)`, `trendByPlaybook(game, playbook?)`, `diffCounts(game, runA, runB)`, `diffMembers(game, runA, runB, playbook, direction, page, pageSize)` (uses `EXCEPT`, with LIMIT/OFFSET; membership-availability flag from presence of rows for both runs).
FE: new "Sweeps" lens in `case-ledger.tsx` (open Q3 default — tab, not new route). Sub-surfaces:
1. Trend: per-playbook line/sparkline of cohort_size across runs (token-styled; if a chart lib already used elsewhere, reuse it — else minimal SVG matching design tokens).
2. Two-run picker: two run dropdowns (from runs endpoint) → table of per-playbook deltas (cohortA→cohortB, opened delta, entered/left counts). Row click → drill panel listing entered/left VIPs, paginated via `queue-pager`, profile-enriched. "Membership pruned for this run" notice when unavailable.
New hook file `src/pages/Dashboards/cs/use-care-sweeps.ts` (mirror `use-care-cases.ts` AbortController pattern): `useSweepRuns`, `useSweepTrend`, `useSweepDiff`, `useSweepDiffVips`.

Data flow: picker selects runA/runB → diff endpoint (counts + entered/left counts) → row click → diff/vips endpoint (paginated uids+profiles).

## Related code files
- **Modify:** `server/src/routes/care-cases.ts` (4 new GET routes, viewer-ok, game-validated).
- **Modify:** `server/src/db/care-sweep-run-store.ts` (read/diff fns; `EXCEPT` queries).
- **Create:** `src/pages/Dashboards/cs/use-care-sweeps.ts` (hooks).
- **Create:** `src/pages/Dashboards/cs/sweeps-lens.tsx` (trend + picker + diff table; split if >200 LOC into `sweeps-trend.tsx` + `sweeps-diff-picker.tsx` + `sweeps-vip-drill.tsx`).
- **Modify:** `src/pages/Dashboards/cs/case-ledger.tsx` (add "Sweeps" to LensToggle, render `sweeps-lens`).
- **Reuse:** `queue-pager.tsx` for drill-to-VIPs.
- **Delete:** none.

## Implementation steps
1. Store read fns: runs list, trend series, diff counts, diff members (EXCEPT + paginate). Membership-availability flag.
2. Add 4 GET routes (viewer-ok, validate runs ∈ game, clamp pagination). Diff/vips enriches page slice with `getVipProfiles`.
3. FE hooks in `use-care-sweeps.ts`.
4. `sweeps-lens.tsx`: trend (token-styled SVG/existing chart), run picker, per-playbook delta table.
5. Drill panel: entered/left VIP list, paginated (reuse pager), profile-enriched; pruned-membership notice.
6. Add "Sweeps" lens to LensToggle; reset state on game switch.
7. Design cross-check vs `case-ledger.tsx` (tokens, header pattern, semantic status colors for +/- deltas: `--success-ink` entered, `--destructive-ink` left). Build + typecheck.

## Todo
- [ ] Store: runs/trend/diff-counts/diff-members (EXCEPT + paginate)
- [ ] 4 GET routes (viewer-ok, validated, paginated)
- [ ] use-care-sweeps hooks
- [ ] Sweeps lens: trend + picker + delta table (modularized if >200 LOC)
- [ ] VIP drill (paginated, enriched, pruned-state)
- [ ] LensToggle integration + design cross-check
- [ ] Tests (trend ordering; entered/left set diff correctness; pruned-membership degrade; pagination)
- [ ] Build/typecheck clean

## Success criteria
- Trend shows cohort_size per playbook across ≥2 runs, time-ordered.
- Diff picker: entered = B\A, left = A\B (verified against seeded membership); counts match.
- Drill lists correct VIPs, 50/page, priority/profile shown; no urgent dropped.
- Pruned-run selection → counts-only + clear notice, no crash.
- Design parity with Case Ledger.

## Risk + mitigation
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Membership pruned → diff misleading/empty | M×M | `membershipAvailable` flag + UI notice; counts always from playbook_results (kept 365d) |
| EXCEPT over 23k×2 uid sets slow | L×M | Indexed `(run_id, playbook_id)`; paginate drill; counts via COUNT(EXCEPT subquery) |
| runA/runB from different game spoofed | L×M | Validate both runs' game = query game; 400 otherwise |
| Sweeps lens >200 LOC | M×L | Split into trend/picker/drill components |
| New chart lib added unnecessarily | M×L | Reuse existing viz or minimal token-styled SVG (YAGNI) |

## Security
- All 4 routes viewer-ok reads (no mutation). Game-scoped validation prevents cross-game run leakage. Membership uids same trust boundary as queue.

## Next steps
- Final phase. After: update `docs/` if a new CS surface warrants codebase-summary entry; consider `docs/lessons-learned.md` entry if membership-prune-vs-diff interaction bit during impl.
