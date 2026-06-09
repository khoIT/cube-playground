# Care Playbook Coverage Expansion — Final Coverage Report (cfm_vn)

**Date:** 2026-06-09 (GMT+7) · **Plan:** `plans/260609-1515-care-playbook-coverage-expansion/`
**Outcome:** 4 available → **12 available** (+5 partial, 4 blocked). Available+partial = **17/21** = the plan's headline target.

## Live verdict (`/api/care/playbooks?game=cfm_vn`)
| verdict | count | ids |
|---|---|---|
| available | 12 | 01,02,03,04,06,08,09,10,14,15,17,18 |
| partial | 5 | 07,11,12 (prop/lottery drill-down), 19,20 (ops-driven) |
| unavailable | 4 | 05,13,16,21 (no real source — blocked) |

## Live cohort sizes (VIP-gated sweep, ltv ≥ ₫1M)
| PB | name | cohort | mart | as-of |
|---|---|---|---|---|
| 01 | first deposit | 1067 | mf_users | 2026-06-09 |
| 02 | VIP tier | 16290 | mf_users (tier bands) | 2026-06-09 |
| 03 | spend spike | 88 | user_recharge_rolling | 2026-06-09 |
| 04 | spend drop | 1683 | user_recharge_rolling | 2026-06-09 |
| 06 | top leaderboard (rank ≤10) | 9 | user_gameplay_daily | 2026-05-01 |
| 08 | rank drop (in-season >5 tiers) | 1 | user_gameplay_daily | 2026-05-01 |
| 09 | major achievement (rank =1) | 1 | user_gameplay_daily | 2026-05-01 |
| 10 | guild instability (clan switch) | 213 | user_gameplay_daily | 2026-05-01 |
| 14 | no-login ≥N | 4249 | mf_users | 2026-06-09 |
| 15 | session-time drop | 1230 | user_active_rolling | 2026-06-09 |
| 17 | clan left | 156 | user_gameplay_daily | 2026-05-01 |
| 18 | anniversary | 22 | mf_users (offset OR-set) | 2026-06-09 |

No playbook matches the whole VIP base (02 = base by definition; all others are proper subsets). Fail-closed guard + empty-filter guard intact.

## Data caveats (must surface to CS before demo)
- **Two as-of dates.** Spend/churn/anniversary playbooks read live mf_users + rolling std marts → as-of **2026-06-09**. Gameplay/clan playbooks (06/08/09/10/17) read `etl_ingame_game_detail`, whose data ends **2026-05-01** → ~5 weeks staler. This is the locked per-game data-anchor behavior, not a bug. **SHIPPED:** `GET /api/care/data-freshness` resolves `cube → YYYY-MM-DD` (MAX of each backing cube's canonical time dim); the CS Monitor stamps each playbook row "as of {date}" and shows a header "data as of {min} → {max}" range. Live: gameplay cube = 1 May 2026, all others = 9 Jun 2026. Probe is physicalized so it resolves on prod prefix workspaces too (not just local game_id).
- **08 (rank drop) cohort = 1.** The game_detail anchor lands ~4 days into a fresh ladder season (boundary 2026-04-28), so 48h in-season demotions barely exist yet. Signal is correct; it will populate mid-season. Calibration cannot manufacture a cohort the data lacks.
- **07/11/12 stay partial (deferred Phase 05).** Rare-prop / SSR-tier semantics are unresolvable: `prop_quality` (0–4) has no rarity mapping (tier 4 is most common), lottery `result` codes are an unlabeled long tail, `luck_point` (0–99) has an unknown reset rule, and the tlog enum doc (`cfm_tlog_desc…xml`) is not in the repo. Per user decision: do NOT fabricate rarity — keep drill-down-only until the enum doc is available.

## Modeling decisions worth remembering (gameplay mart)
- `ladder_rank` ranks on **lifetime** `totalladderscore` (survives the per-season reset → valid global rank).
- `ladder_rank_drop_48h` scopes the tier comparison to the **anchor season** (`ladderlevelbeforematch` resets per season, else a rollover reads as mass demotion).
- clan switch/leave = **1/0 flags** from a cross-window `clan_id` diff, gated with `abs(=1)` not an event-window (an event-window fires a 2nd anchor-probe query that times out on this raw-match mart → empty cohort). clan-left requires current-window activity so churn isn't mis-flagged.
- Per-window clan attribution folds across a user's roles independently (current clan from the role most active this window; prior clan from the role most active the prior window).
- Partition prune on `log_month` uses a **scalar subquery** (a CROSS-JOIN-derived bound scans the full history → 17s; scalar-subquery prune → 8s, under the 15s client timeout).

(All three reusable gotchas captured in `docs/lessons-learned.md`.)

## Shipped commits (main, local only — NOT pushed to `second`/prod)
- `4a65bb6` data anchor + spend/session/anniversary registry fixes (Phases 01–02)
- `888c489` rolling spend/session marts (Phase 03)
- `74d5d58` gameplay/clan mart (Phase 04)
- `170cb0a` plan status

## Remaining work
1. **Phase 05** when the tlog enum doc is supplied → 07/11/12 from partial → available (would reach 15 available / 19 supported).
2. Generalize the marts to other games (jus_vn, ballistar_vn) — follow-up, out of scope.

## As-of surfacing — implementation note (shipped)
- New read-only route `GET /api/care/data-freshness?game=` (`server/src/routes/care-data-freshness.ts`) + resolver `server/src/care/data-freshness.ts`: discovers each cube's canonical time dim from /meta (prefers `log_date`), probes MAX in parallel (cached ~10 min via resolveDataAnchor, fails safe to today), returns `cube → YYYY-MM-DD` for the cubes backing queryable playbooks.
- Kept SEPARATE from `/api/care/playbooks` on purpose: a cold MAX probe on the heavy gameplay mart is ~8s, so the registry list stays fast and the labels fill in async (`use-care-data-freshness.ts`).
- FE: per-row "as of {date}" under the Data badge (`playbook-grid.tsx`) + header "data as of {min} → {max}" (`index.tsx`); both token-compliant.
- Probe member is physicalized (`physicalMember`) so it resolves on prod prefix workspaces, not only local game_id; unit-tested both ways. Tests: 5 server + 7 FE.

## Unresolved questions
1. Is the ~5-week gameplay-data lag (etl ends 2026-05-01) expected to persist, or will etl catch up? The anchor auto-advances to today when it does (no code change), but the demo narrative depends on the answer.
