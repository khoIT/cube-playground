# Red-Team Plan Review — Failure-Mode Analyst + Flow Tracer

**Plan:** 260614-0040-per-game-ops-enrichment-four-layers
**Reviewer lens:** Murphy's Law (data loss, cascading failures, scan blowups, refresh/seal races, rollback gaps) + Flow Tracer (riskiest path: thinking_data → behavior_profile cube → mf_users join → pre-agg → user_360 view → segment/dashboard consumer).
**Verdict:** Plan is structurally sound and verification-gated, but three findings are CRITICAL because they contradict mechanisms that already exist in this exact codebase. Do not start Phase 2 cube authoring until Findings 1, 2, 3 are resolved.

---

## Finding 1: New behavior/event cubes escape the existing query-bounds guard — unbounded full-table scan of thinking_data is possible

**Severity:** Critical

**Location:** Phase 03 §Key Insights line 26 + §Implementation step 5; Phase 08 §Implementation step 1. Plan top-level Top-risk #2.

**Flaw:** The plan asserts scan blowups are prevented by "mandatory date-partition pruning + CubeStore pre-aggs (phase 8)." But this repo already has a runtime guard, `enforceBehaviorBounds`, that REJECTS unbounded queries against big event cubes — and it will NOT cover the new cubes. The guard only fires for cubes matching the regex `^(?:[a-z][a-z0-9]*_)?etl_[a-z0-9_]+$` OR cubes/views in a hardcoded `BEHAVIOR_VIEWS` allowlist. The planned cubes are named `behavior_profile`, `payment_callback`, and a future `{game}__events` — none match `etl_*`, none are in the allowlist. So `touchesBehavior()` returns false and `enforceBehaviorBounds` lets an unbounded query through.

**Failure scenario:** Phase 6 wires `behavior_profile` into `user_360`. A user opens the 360 view in Playground with no date filter (or chat-agent issues a broad query). The query hits thinking_data (cfm 198M rows). Pre-agg is DORMANT locally / cold on prod (memory `cubestore-preaggs-dormant-locally`) so the lambda tail falls through to source. Trino cold-scans 198M rows, the `/load` request hangs, and under Trino distress the L4 LB returns the known AbortError 500 (memory `cube-load-aborterror-500-diagnosis`). One naive query degrades the whole game's `/load` endpoint.

**Evidence:** `cube-dev/cube/cube.js:116-120` (regex + allowlist gate), `:198-199` (`.filter(touchesBehavior)` — only matched cubes are bounded), `:96-109` (the `BEHAVIOR_VIEWS` allowlist — no `behavior_profile`/events entry), `:367-370` (queryRewrite calls it). Plan claims protection only via pre-aggs that are documented-dormant in memory `cubestore-preaggs-dormant-locally`.

**Suggested fix:** Phase 3/8 MUST add the new big-table cubes (`behavior_profile`, any `{game}__events`, `payment_callback`) to `BEHAVIOR_VIEWS` (or extend `touchesBehavior`) AND add their time-dim field names to `TIME_DIM_FIELDS` (currently only `log_date`, `dteventtime`, `ts` — thinking_data likely keys on a different column). Without this, partition-pruning is advisory, not enforced. Add a phase task + test: "unbounded query against behavior_profile is rejected with 4xx, not a 200 that scans."

---

## Finding 2: Phase 8 success criterion "assert usedPreAggregations true" directly contradicts this model's own preagg-readiness code

**Severity:** Critical

**Location:** Phase 08 §Description, §Key Insights line 26-27, §Implementation step 4, §Todo "usedPreAggregations", §Success Criteria line 71.

**Flaw:** Phase 8 repeatedly mandates asserting `usedPreAggregations` is true. The repo's own readiness service documents — with a rationale — that this field is UNUSABLE in this model because every rollup is a `rollup_lambda` with `union_with_source_data: true`, which Cube masks to EMPTY `usedPreAggregations`. The plan's own Phase 8 even mandates copying that exact lambda shape (step 1: "copy `user_recharge_daily.yml:157-189` rollup_lambda union"). So the plan prescribes building lambdas and then asserting a field that lambdas are known to blank out — the test will read every new rollup as passthrough no matter how completely it builds, producing either false failures or false confidence.

**Failure scenario:** Phase 8 integration test asserts `usedPreAggregations === true`. Lambda union returns it empty. Either (a) the test fails permanently and someone "fixes" it by removing the assertion (losing all routing coverage), or (b) the test is written to tolerate empty (per the plan's hedge "tolerate cold fallback") and then it proves nothing — a non-building rollup full-scanning source passes CI green. Both outcomes defeat the phase's stated purpose ("prevents scan blowups").

**Evidence:** `server/src/services/preagg-readiness.ts:15-21` — verbatim: "Why NOT usedPreAggregations: every cube in this model exposes its rollup via a rollup_lambda ... Cube masks usedPreAggregations to EMPTY for lambda unions ... The compiled-SQL FROM clause is the honest routing signal." Plan Phase 8 mandates the lambda shape (`user_recharge_daily.yml:185-189` is a `rollup_lambda`).

**Suggested fix:** Replace every "assert usedPreAggregations" in Phase 8 with "assert via the existing preagg-readiness compiled-SQL FROM-clause signal" — reuse `server/src/services/preagg-readiness.ts` and `cubestore-query-cache-check.ts` (`extractPlannedPreaggs`) rather than inventing a new assertion that the codebase already proved wrong. This is the verified pattern; do not re-derive it.

---

## Finding 3: Freshness "enforcement" is a description string with NO runtime gate — nothing stops a lagging cube from driving a live segment/alert

**Severity:** Critical

**Location:** plan.md §Freshness-tier legend lines 31-40, Top-risk #3; Phase 06 §Key Insights line 21-22; Phase 07 §Key Insights line 26 ("Freshness tier MUST guard live UI") + Risk "Freshness leak."

**Flaw:** The governing constraint of the entire plan is the freshness tier, but it lives only in a `description:` string prefix `[freshness: lagging]` and an optional `meta:` block. The plan calls this an "enforcement mechanism" and a "guard," but a string is advisory. There is no code path that reads the tier and blocks a lagging cube from a segment gate, dashboard alert, or chat live-decision. Phase 7's "freshness badge/guard in the UI" is a visual label, not a gate — a user can still build a segment on `lifecycle_profile.churn_gap` (vga, 2mo stale) and gate live cohort membership on it. The chat-agent claim ("surfaces this tag verbatim") was not verifiable — chat.ts reads game `/meta` but I found no code that parses a `[freshness:]` token or `meta.freshness`.

**Failure scenario:** Phase 7 adds `churn_gap` (vga-sourced, tagged lagging) as a segment dimension. A CS lead builds a live VIP-care segment "users inactive 14+ days" gating today's outreach. vga is 2 months stale (unresolved Q4, cause unknown), so "last active" is 2 months behind reality — the segment includes thousands of users who actually logged in last week. Outreach fires on wrong cohort. The freshness badge sat next to the field but the gate had no teeth.

**Evidence:** plan.md:39 ("Every new cube `description:` MUST begin with ..."), Phase 07:74 ("Mitigate: mandatory freshness badge + label" — label, not gate). Grep for `freshness` across `cubes/`, `views/`, `cube.js`, and chat surfaces returned ZERO existing parsing/enforcement. `server/src/routes/chat.ts:455` reads `/meta` but no freshness-token handling found.

**Suggested fix:** Either (a) downgrade the plan's language from "enforcement/guard" to "advisory labeling" and accept the risk explicitly with user sign-off, OR (b) add a real gate: when a segment/alert references a member whose source cube is tagged `lagging`/`archive`, block it (or require explicit override) at `server/src/lakehouse/segment-metric-registry.ts` evidence-gating time. A `description` prefix cannot be the load-bearing safety mechanism for "live decisions." Add an unresolved question: "Does anything machine-read the freshness tier, or is it human-only?"

---

## Finding 4: Phase 1 match-rate probe is one-time — no regression guard against bridge rot when stale sources shift

**Severity:** High

**Location:** Phase 01 §Overview, §Success Criteria; plan.md Top-risk #1 ("every bridge must be empirically probed ... before any cube trusts it"). Phase 08 freshness-regression test (does grain/match-rate, not bridge match-rate over time).

**Flaw:** Phase 1 measures match-rate ONCE and bakes the chosen key into cube SQL. The sources are explicitly volatile: vga is ~2mo stale with unknown cause (Q4: "sync throttle vs broken pipeline"), map_afid_uid noted stale in the red-team brief, thinking_data ~4mo. A bridge that is 80% match today silently rots if the upstream id-namespace or sync changes. Phase 8's freshness-regression test only asserts the `[freshness:]` tag matches the source tier — it does NOT re-measure match-rate. There is no scheduled re-probe.

**Failure scenario:** vga pipeline breaks further (Q4 unresolved). `lifecycle_profile` bridge match-rate drops from 70% to 5% over a month. No test catches it because match-rate is never re-asserted. `user_360` quietly returns NULL lifecycle attributes for 95% of users; downstream measures (churn-gap averages) compute over the surviving 5% and look "fine" — a silent NULL fan-out that biases every aggregate.

**Evidence:** Phase 01:53-60 (probe is a phase-1 discovery step, written to a static markdown spec, not a recurring check). Phase 08:58 freshness-regression test asserts tag↔tier only. unresolved-questions.md Q4/Q6/Q7 all flag volatile match-rates with no re-measurement plan.

**Suggested fix:** Add to Phase 8 a match-rate regression assertion per bridged cube: query `matched/total` against the live source and fail if it drops below a phase-1-recorded floor (e.g. 0.7× the baseline). Surface `unresolved_share` (already planned for CS in Phase 4 §step 2) as a measure on EVERY bridged cube, not just CS, so a rotting bridge is visible in the data, not hidden in NULLs.

---

## Finding 5: NULL fan-out from unmatched bridge rows pollutes user-grain measures and view aggregates

**Severity:** High

**Location:** Phase 02 §Risk "pmt_user_daily fan-out"; Phase 03 §Risk "thinking_data user_vga_id NULL"; Phase 06 user_360 view extension. Pattern reference: `recharge.yml:11-15`.

**Flaw:** The recharge bridge pattern the plan copies uses LEFT JOIN to the std bridge — unmatched rows keep NULL `gds_user_id` (recharge.yml:46-49). The recharge cube handles this with an explicit `real_users_only` segment (bridge IS NOT NULL) and documents that unbridged rows "dominate raw iamount" (recharge.yml:19-21). The new cubes copy the LEFT-JOIN bridge but the plan does NOT mandate the equivalent `real_users_only`-style segment/filter on each. Without it, a `revenue_vnd_gross` sum or `paying_users count_distinct_approx` on `payer_daily` aggregates over unbridged rows too — and the recharge precedent proves unbridged rows can dominate raw monetary totals.

**Failure scenario:** `payer_daily.revenue_vnd_gross` is summed for a dashboard card without a bridge-not-null filter. Unbridged load-test/dummy rows (recharge.yml documents iamount of 11.0B of 11.04B was unbridged on one day) inflate revenue by orders of magnitude. The card ships, a stakeholder sees 100× real revenue.

**Evidence:** `cube-dev/cube/model/cubes/cfm/recharge.yml:11-21` (unbridged rows dominate raw amounts; `real_users_only` segment is the documented countermeasure), `:18-19` (`user_type='st_dummy'` on EVERY row — does NOT discriminate test traffic). Plan Phase 2 measures (line 54) define gross-rev sum with no bridge-not-null gate mentioned.

**Suggested fix:** Phase 2/3/4 must mandate a `real_users_only`-equivalent segment (bridge gds_user_id IS NOT NULL) on every bridged cube AND apply it (or document why not) before any measure is summed. Add the recharge caveat block to each new cube's description. Phase 8 ground-truth test must compare a known user's total to raw WITH the bridge filter applied.

---

## Finding 6: Phase 8 deploy/restart + compile-failure rollback is not specified — one bad YAML takes down the whole game's model load

**Severity:** High

**Location:** Phase 08 (no deploy/rollback section); plan.md §effort/branch. Red-team brief deploy/rollback focus.

**Flaw:** `repositoryFactory` reads ALL `.yml`/`.yaml`/`.js` files in `model/cubes/{game}/` and `model/views/{game}/` at request time and concatenates them into one model compile (`cube.js:336-353`). If ANY one of the ~9 new cube YAMLs per game has a compile error (bad join SQL, undefined member referenced by the extended `user_360` view), the ENTIRE game model fails to compile — not just the new cube. Every existing dashboard/segment/Catalog query for that game breaks. The plan has no rollback step, no staged rollout, and no "compile in isolation before dropping into the live folder" gate. Phase 8 §Risk mentions "restart cube_api" for dormant pre-aggs but never addresses compile-failure blast radius. On prod DEV_MODE=false there is no hot-reload, so a bad deploy requires a manual restart to even retry (memory `cube-serving-instance-needs-restart-for-new-rollups`).

**Failure scenario:** Phase 6 extends `views/cfm/user_360.yml` to reference `behavior_profile.churn_gap`, but a typo names it `churn_gap_days`. Deploy to prod. cfm model compile throws on the unknown member. `/meta` and `/load` for cfm now 500 for ALL cubes (recharge, mf_users, everything). cfm dashboards go dark until someone reverts and restarts cube_api. No rollback playbook exists.

**Evidence:** `cube-dev/cube/cube.js:336-353` (whole-folder read → single model compile; one file's error fails the set). Memory `cube-serving-instance-needs-restart-for-new-rollups` (DEV_MODE=false = no hot-reload). Phase 08 has no rollback/staging section.

**Suggested fix:** Add a Phase 8 deploy gate: (1) compile-check each new YAML in isolation against the game model BEFORE it lands in the live folder (cube `/meta` on a staging model dir); (2) deploy cubes WITHOUT the user_360 view edit first, verify, then add the view edit (so a view-ref typo can't take down standalone cubes); (3) document the rollback = `git revert` + cube_api restart, and who runs it. Treat the view extension as the highest-blast-radius change.

---

## Finding 7: pmt_user_daily product-grain join can fan-out mf_users LTV dims (1:N inflation), not just revenue

**Severity:** Medium

**Location:** Phase 02 §Key Insights line 22-23, §Architecture line 39-40, §Risk "pmt_user_daily fan-out."

**Flaw:** The plan correctly notes `pmt_user_daily` is user×product×day (1:N) joined many_to_one to mf_users, and guards revenue by "measures aggregate at user grain." But user_360 view composition (Phase 6) joins payer_daily ALONGSIDE the existing user_recharge_daily, recharge, active_daily, etc. — the view already has ~13 join_paths (`views/cfm/user_360.yml`). Adding another 1:N cube to a view that already fans across multiple 1:N cubes risks a multiplicative cartesian blow-up at view-query time, where mf_users-level measures (e.g. `ltv_total_vnd`) get multiplied by the product-row count. The plan's fan-out mitigation is scoped to the payer_daily cube in isolation (Phase 2), not to the view-level multi-fact composition (Phase 6).

**Failure scenario:** user_360 query selects `mf_users.ltv_total_vnd` (1 row/user) and `payer_daily.revenue_vnd_gross` together. The view join produces one row per (user × product × day); mf_users.ltv_total_vnd repeats across every product row and, if summed, inflates by the product-row count. Whale LTV reported 20× actual.

**Evidence:** `cube-dev/cube/model/views/cfm/user_360.yml` has 13 `join_path` entries already (verified via grep: mf_users, active_daily, user_recharge_daily, recharge, user_roles, user_devices, user_ips, user_active_monthly, user_recharge_monthly, etl_room_match_flow, etl_team_start_match_flow, etl_money_flow). Phase 06:42-46 adds more 1:N cubes to this set. Phase 02 fan-out mitigation (line 78-79) addresses the cube, not the view.

**Suggested fix:** Phase 6 must explicitly state which MEASURES (vs dimensions) from each new 1:N cube are safe to expose in user_360, and verify a multi-fact query (mf_users LTV + payer_daily revenue + recharge) against a known whale's true totals. Prefer surfacing the new cubes' dims (tier, recency band) in the view and keeping additive measures queried against the cube directly, not blended in the view. Add this assertion to Phase 8 ground-truth tests.

---

## Finding 8: Phase 4 claims cs_ticket_new_master is an existing CUBE to "not rebuild" — it is a raw Trino reader, not a cube

**Severity:** Medium

**Location:** Phase 04 §Context Links line 11 ("Already used: cs_ticket_new_master (do NOT rebuild — these ADD depth)"), §Related Code Files line 45 ("existing cs_ticket_new_master cube (find via grep) for dedup precedent").

**Flaw:** The plan frames `cs_ticket_new_master` as an existing Cube cube that the new `cs_ticket_detail.yml` complements. It is not a cube — it is a direct Trino-REST reader in `server/src/lakehouse/cs-ticket-reader.ts` (and `cs-ticket-detail-reader.ts`), bypassing Cube entirely. This matters because: (a) the "dedup precedent" the plan tells the implementer to copy lives in TypeScript SQL-string building, not in a YAML cube the implementer can mirror; (b) there is now a risk of TWO divergent CS data paths (the existing reader and the new cube) computing different ticket counts/dedup from the same source, with no reconciliation plan; (c) Phase 7 wires the new cube into member360/care, but the existing care surfaces already consume the reader — divergent numbers on the same screen.

**Failure scenario:** `cs_ticket_detail.yml` dedups via "canonical status filter" (Phase 4 step 5), while the existing reader dedups via `rn=1` over a different partition (`cs-ticket-reader.ts`). The care tab shows ticket count 412 from the cube and 389 from the reader on adjacent widgets. Support lead loses trust in the data.

**Evidence:** `server/src/lakehouse/cs-ticket-reader.ts:22` (`import runQuery from trino-rest-client` — direct Trino, not Cube), `:104-125` (raw SQL FROM cs_ticket_info / cs_ticket_new_master with `rn=1` dedup). grep confirmed NO `cs_ticket_new_master` reference in `cubes/cfm` or `cubes/jus`. Plan Phase 04:11,45 calls it a cube.

**Suggested fix:** Correct Phase 4 to state cs_ticket_new_master is a raw reader, not a cube. Decide explicitly: does the new cube REPLACE the reader path for member360/care (then plan the cutover + reader deprecation), or COEXIST (then add a reconciliation test asserting cube and reader return matching ticket counts for a known user)? Copy the dedup logic from `cs-ticket-reader.ts:104-125`, not from a nonexistent cube.

---

## Summary table

| # | Severity | One-line |
|---|----------|----------|
| 1 | Critical | New behavior/event cubes bypass `enforceBehaviorBounds` (regex/allowlist gate) → unbounded thinking_data scan → /load AbortError 500 |
| 2 | Critical | Phase 8 "assert usedPreAggregations" contradicts repo's own preagg-readiness.ts (lambda masks the field) |
| 3 | Critical | Freshness tier is a description string, not a runtime gate — lagging cube can drive a live segment/alert |
| 4 | High | Phase 1 match-rate probe is one-time; no regression guard against bridge rot on stale (vga 2mo) sources |
| 5 | High | Bridged cubes copy LEFT-JOIN pattern but not recharge's `real_users_only` filter → unbridged rows inflate revenue measures |
| 6 | High | One bad YAML fails the whole game model compile (whole-folder repositoryFactory); no rollback/staging in Phase 8 |
| 7 | Medium | Adding 1:N payer_daily to an already 13-join user_360 view risks multiplicative LTV fan-out at view-query time |
| 8 | Medium | cs_ticket_new_master is a raw Trino reader, not a cube — divergent CS data paths, plan mislabels it |

## Unresolved questions (carry into build gating)

1. Does ANY code machine-read the `[freshness:]` tag / `meta.freshness`, or is Finding 3 fully unenforced today? (chat.ts reads /meta but no freshness parsing found — needs confirmation before claiming "chat-agent surfaces it.")
2. What is thinking_data's actual time-dimension column name? `TIME_DIM_FIELDS` (cube.js:111) knows only `log_date`/`dteventtime`/`ts` — if thinking_data uses another, even adding it to BEHAVIOR_VIEWS won't bound it (Finding 1).
3. For Finding 8: replace-or-coexist decision on the cs reader vs new cube is a product/architecture call, not derivable from code.
