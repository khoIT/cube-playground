# Care Playbook Coverage Expansion — 9/21 → 17/21

**Goal:** make the most VIP-care playbooks cohort-queryable for the CS dashboard demo, using real cfm_vn data. Defer the trigger engine — run everything as daily cohort sweeps.

## Context
- Investigation: live `/meta` + Trino confirm **9/21** today (4 available, 5 partial, 12 unavailable).
- Root causes: (a) registry member-name mismatches; (b) raw-etl behavior data lags (ends ~early May 2026, today Jun 9) + 31-day query guard; (c) gameplay/clan/prop/lottery only modeled as raw events, no cohort-scannable mart; (d) `mf_users` anniversary window unsupported by the date expander.
- 4 stay blocked (no real source): **05** payment-fail, **13** sentiment, **16** support ticket, **21** birthday.

## Locked decisions (user)
1. **Per-game data as-of anchor** — relative windows resolve from the latest date-with-data, not `now()`.
2. **Materialize rolling measures in Cube YAML** for 03/04/15 (no app-side trigger engine).
3. **Target all 13 fixable → 17/21**, phased high-value-first.
4. **cfm_vn-only marts** in the `cube-api` repo for now.

## Phases
| # | Phase | Unlocks | Status |
|---|-------|---------|--------|
| 01 | [Data as-of anchor + daily sweep cadence](phase-01-data-anchor-and-daily-sweep.md) | foundation (all etl) | ✅ anchor mechanism done (cadence kept at 6h — already periodic) |
| 02 | [Registry member-name + window fixes](phase-02-registry-member-and-window-fixes.md) | 18; preps 03/04/15 | ✅ member fixes (03/04/15→log_date) + anniversary (18) offset-day OR-set, done + tested |
| 03 | [Rolling spend/session marts](phase-03-rolling-spend-session-marts.md) | 03, 04, 15 | ✅ marts built + validated live + calibrated (88 / 1683 / 1230 VIP cohorts). Committed 888c489. |
| 04 | [Gameplay + clan daily mart](phase-04-gameplay-clan-daily-mart.md) | 06, 08, 09, 10, 17 | ✅ `user_gameplay_daily` built + validated live + swept (06=9 / 08=1 / 09=1 / 10=213 / 17=156 VIP cohorts) |
| 05 | [Prop + lottery rollup marts](phase-05-prop-lottery-rollup-marts.md) | 07, 11, 12 | ☐ blocked on rare-prop/SSR signal existence verify |
| 06 | [Integration, validation, demo verify](phase-06-integration-validation-demo.md) | all | ☐ |

## Key dependencies
- Phase 01 is foundational — 03/04/15/06/08/09/10/17/07/11/12 all need the anchor to return non-empty cohorts.
- Phases 03–05 each: new `cube-api` YAML → repoint registry `dataRequirements`/predicate → verify availability flips → sweep produces a cohort.
- Phase 06 gates the demo: every targeted playbook produces a non-empty, plausible cohort in the CS dashboard.

## Out of scope
- App-side per-member trigger engine (deferred — replaced by materialized rolling columns + daily sweep).
- 05/13/16/21 (no real source). Generalizing marts to other games. Pushing to the `second` (prod) remote.

## Target outcome
17/21 playbooks available/partial and producing cohorts in the CS dashboard for cfm_vn, on real (anchored) data.

## Build note — Phase 03 rolling marts (validated live)
Two marts in `cube-dev/.../cfm/`: `user_recharge_rolling`, `user_active_rolling`. Grain = one row per user **as of the data anchor** (MAX log_date), trailing 1d/7d/30d via CASE-window SUMs — this grain (not "latest recharge/active day") is what lets spend/session DROP be visible (a user gone quiet has 7d_total=0). `user_id` must be `public: true` (it's the PK and the cohort fetcher selects it). Live distributions on cfm:
- 03 spike_ratio≥3 → **105** users (prior-29d-day baseline excludes one-time payers). Demo-ready.
- 04 drop_ratio<0.3 → **25,819 / 33,582** (degenerate): recharge is sparse, 71% just didn't pay in 7d; the ratio=0 bucket (23,997) is churn, not decline.
- 15 session_ratio<0.4 → **358,410 / 661,691** (degenerate): activity is dense.
**Phase-06 calibration must redefine 04/15**, not just retune: exclude ratio=0 (→ PB14 churn), require a real 30d baseline (engaged VIPs only), and pick thresholds from the live ratio distribution (likely a percentile rule). Spike's prior-baseline trick is the template.

## Build note — Phase 04 gameplay/clan mart (validated live)
One mart `user_gameplay_daily` in `cube-dev/.../cfm/`, per user as of the data anchor (MAX game_detail day = **2026-05-01**, ~5wk staler than the spend/session anchor at 2026-06-09 — inherent: game_detail data ends May 1; per-game anchor is locked decision #1, Phase 06 surfaces as-of date).
- Identity verified live: `playerid → mf_ingame_roles.role_id → user_id`, ~100% coverage (56,388 playerids ↔ 56,813 user_ids, HLL noise).
- Signals: `ladder_rank` = global RANK by **lifetime** `totalladderscore` (survives season reset → valid). `ladder_rank_drop_48h` = in-season `ladderlevelbeforematch` tier drop (level RESETS per season — a season boundary on 04-28 forced scoping the drop to the anchor season, else mass false demotions). `clan_switched_recent` / `clan_left_recent` = 1/0 flags from cross-window `clan_id` diff (current window = anchor+prior day, prior = d-3..d-2); clan-left requires `matches_cur>0` so churn (didn't-play → null clan) isn't mis-read as leaving.
- Cohorts (VIP-gated, live sweep): 06=9, 08=1, 09=1, 10=213, 17=156. **08 is genuinely tiny** — the anchor lands ~4d into a fresh ladder season, so 48h demotions barely exist yet (will populate mid-season). Not a bug; calibration can't manufacture a cohort the data lacks.
- Perf: raw-match source (monthly partitions, ~1M/day) → cold query 17s (over the 15s client timeout) until the partition prune was made a scalar subquery (CROSS-JOIN-derived bound doesn't prune) → 8s cold. 10/17 use abs(flag=1), NOT event-window, to avoid a second anchor-probe query that timed out → empty cohort. (Both gotchas + the YAML-folded-comment trap are in docs/lessons-learned.md.)

## Build note — model directory (discovered during impl)
The plan's phase files write marts to `../cube-api/cube/model/cubes/cfm_vn/`, but the **local** demo Cube (`cube_api_dev:4000`, `docker-compose.devcube.yml`) mounts `./cube-dev/cube` and resolves app-game `cfm_vn` → alias → canonical `cfm` → loads `./cube-dev/cube/model/cubes/cfm/`. So new marts must land in `./cube-dev/.../cfm/` for the local CS-dashboard demo to serve them; `../cube-api/.../cfm_vn/` is a separate (prod-source-style) tree the local cube does not serve. Pending user decision (Phases 03–05).
