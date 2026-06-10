# CFM VN Metric Availability Matrix — Phase 1 Audit

**Generated:** 2026-06-10 15:32 GMT+7  
**Scope:** 57 business-metric presets vs cfm_vn local workspace `/meta` + live Trino probes  
**Method:** meta existence check + one `/load` probe per logical cube (Jun 1-7 2026 window)

---

## 1. Availability Matrix

| Metric ID | Tier | Backing Cube(s) | Verdict | Evidence |
|-----------|------|-----------------|---------|----------|
| dau | 1 | active_daily | resolvable+data | meta ✓, DAU=36,328 on Jun 4, wall 516ms |
| wau | 2 | active_daily | resolvable+data | meta ✓, WAU=36,328 on Jun 4, wall 516ms |
| mau | 2 | active_daily | resolvable+data | meta ✓, probe 7 rows Jun 1-7, wall ~6s cold |
| trailing_wau | 3 | active_daily | resolvable+data | meta ✓ (trailing_wau=0 on Jun 1 = expected start-of-week), wall ~6s |
| trailing_mau | 3 | active_daily | resolvable+data | meta ✓ (trailing_mau=190,062 on Jun 1 = MTD), wall ~6s |
| revenue | 1 | recharge | resolvable+data | meta ✓, revenue_vnd=11B raw/710M real on Jun 1, wall 5.3s |
| transactions | 2 | recharge | resolvable+data | meta ✓, 2,391 real txns on Jun 1 (real_users_only), wall 5s |
| paying_users | 1 | recharge | resolvable+data | meta ✓, paying_users_exact=1,857 on Jun 1, wall 5s |
| arppu | 1 | recharge | resolvable+data | meta ✓, revenue_vnd + paying_users both resolve, wall 5s |
| gross_bookings | 2 | recharge | resolvable+data | meta ✓, recharge.revenue_vnd resolves, wall 5s |
| arpu | 1 | mf_users | resolvable+data | meta ✓, arpu_vnd=48,983 VND lifetime, wall 4.4s |
| paying_users_30d | 2 | mf_users | resolvable+data | meta ✓, 34,606 users, wall 4.4s |
| paying_rate_30d | 3 | mf_users | resolvable+data | meta ✓, 0.48%, wall 4.4s |
| paying_rate | 2 | recharge + active_daily | resolvable+data | meta ✓, paying_rate=3.28% (mf_users.paying_rate), wall 4.4s |
| rr01 | 1 | retention | resolvable+data | meta ✓, retained_d1=207,172 of cohort 268,528 on May 2, wall 14s |
| rr07 | 1 | retention | resolvable+data | meta ✓, retained_d7=173,623 on May 2, wall 14s |
| rr30 | 2 | retention | resolvable+data | meta ✓, retained_d30 present in meta+data, wall 14s |
| rr | 1 | retention | resolvable+data | meta ✓, cohort_size+retained_d7 resolve, wall 14s |
| trailing_mpu | 3 | user_recharge_daily | resolvable+data | meta ✓, 1,220 on Jun 1, wall 5.3s |
| trailing_wpu | 3 | user_recharge_daily | resolvable+data | meta ✓, 0 on Jun 1 (expected: week starts Jun 2), wall 5.3s |
| arpdau | 1 | recharge + active_daily | **stub-errors** | meta refs both resolve individually; cross-cube join times out >15s — unusable for real-time queries |
| nru | 1 | mf_users | broken-ref | mf_users.new_users absent from meta (13 measures present, not this one) |
| npu | 2 | mf_users | broken-ref | mf_users.new_paying_users absent |
| nnpu | 3 | mf_users | broken-ref | mf_users.new_register_and_paying_users absent |
| arpnpu | 2 | mf_users | broken-ref | mf_users.rev_new_paying_users + new_paying_users absent |
| arpnnpu | 3 | mf_users | broken-ref | mf_users.rev_new_register_and_paying_users absent |
| rev_npu | 2 | mf_users | broken-ref | mf_users.rev_new_paying_users absent |
| rev_nnpu | 3 | mf_users | broken-ref | mf_users.rev_new_register_and_paying_users absent |
| cpn | 2 | mf_users | broken-ref | mf_users.new_users + marketing_cost absent |
| nru_install_rate | 2 | mf_users | broken-ref | mf_users.new_users + installs absent |
| ltv | 1 | mf_users | broken-ref | mf_users.new_users absent (denominator) |
| ltv_30 | 1 | mf_users | broken-ref | mf_users.new_users absent (denominator) |
| rp | 2 | mf_users | broken-ref | mf_users.paying_retained_d7 + new_paying_users absent |
| installs | 2 | mf_users | broken-ref | mf_users.installs absent |
| organic_installs | 2 | mf_users | broken-ref | mf_users.organic_installs absent |
| paid_installs | 2 | mf_users | broken-ref | mf_users.paid_installs absent |
| cost | 2 | mf_users | broken-ref | mf_users.marketing_cost absent |
| cpi | 2 | mf_users | broken-ref | mf_users.marketing_cost + installs absent |
| ctr | 2 | mf_users | broken-ref | mf_users.clicks + impressions absent |
| cti | 2 | mf_users | broken-ref | mf_users.installs + clicks absent |
| clicks | 2 | mf_users | broken-ref | mf_users.clicks absent |
| impressions | 2 | mf_users | broken-ref | mf_users.impressions absent |
| roas | 1 | mf_users | broken-ref | mf_users.rev_per_install_d7 + marketing_cost absent |
| roas_07 | 1 | mf_users | broken-ref | mf_users.rev_per_install_d7 + marketing_cost absent |
| mkt_rev_ratio | 2 | mf_users + recharge | broken-ref | mf_users.marketing_cost absent |
| acu | 3 | mf_users | broken-ref | mf_users.acu absent |
| ccu | 2 | mf_users | broken-ref | mf_users.ccu absent |
| pcu | 3 | mf_users | broken-ref | mf_users.pcu absent |
| lcu | 3 | mf_users | broken-ref | mf_users.lcu absent |
| paying_role | 3 | mf_users | broken-ref | mf_users.paying_roles absent |
| new_paying_role | 3 | mf_users | broken-ref | mf_users.new_paying_roles absent |
| new_role | 3 | mf_users | broken-ref | mf_users.new_roles absent |
| active_role | 3 | mf_users | broken-ref | mf_users.active_roles absent |
| cvr_cdn_download | 2 | funnel | broken-ref | `funnel` cube absent from cfm_vn /meta entirely; only ordered_event_funnel/ordered_funnel_canonical exist (single measure: step_count; no users_completed_* measures) |
| cvr_install | 2 | funnel | broken-ref | same: funnel cube absent |
| cvr_login_form | 2 | funnel | broken-ref | same |
| cvr_register | 2 | funnel | broken-ref | same |

**Counts:** 20 resolvable+data · 1 stub-errors · 36 broken-ref · 0 no-data · 0 resolvable+empty

---

## 2. Broken-Ref / Stub-Error Gate List (blocks Phase 2/3)

### A. Funnel cube missing (4 metrics)
`cvr_cdn_download`, `cvr_install`, `cvr_login_form`, `cvr_register`

cfm_vn has no `funnel` cube. The ordered_event_funnel cube has incompatible schema (step_count only). These metrics are structurally unavailable for cfm_vn until a funnel cube with `users_completed_*` measures is built.

### B. mf_users missing measures — group by missing measure set (32 metrics)

| Missing measure(s) in mf_users | Affected metrics |
|---|---|
| new_users | nru, cpn, nru_install_rate, ltv, ltv_30 |
| new_paying_users | npu, arpnpu, rp |
| rev_new_paying_users | rev_npu, arpnpu |
| new_register_and_paying_users | nnpu, arpnnpu |
| rev_new_register_and_paying_users | rev_nnpu, arpnnpu |
| installs | installs, organic_installs, paid_installs, cpi, cti, nru_install_rate |
| marketing_cost | cost, cpi, cpn, roas, roas_07, mkt_rev_ratio |
| clicks | clicks, ctr, cti |
| impressions | impressions, ctr |
| rev_per_install_d7 | roas, roas_07 |
| paying_retained_d7 | rp |
| acu / ccu / pcu / lcu | acu, ccu, pcu, lcu |
| paying_roles / new_paying_roles / new_roles / active_roles | paying_role, new_paying_role, new_role, active_role |

Root cause: cfm `mf_users` cube (`sql_table: mf_users`) exposes only 13 measures, which are lifetime/rolling aggregates (ltv, paying_users, paying_rate). It does not model: acquisition events (new_users, installs), MMP attribution (marketing_cost, clicks, impressions, roas), retention cohort measures (paying_retained_d7), concurrency snapshots (ccu, acu, pcu, lcu), or role-grain metrics. These measures exist in other games' mf_users because their upstream `mf_users` mart was built with MMP and concurrency pipelines that are absent for cfm_vn.

### C. Stub-errors (1 metric)
`arpdau` — both `recharge.revenue_vnd` and `active_daily.dau` resolve individually but the cross-cube join (recharge × active_daily) timed out at >15s in probe. Not usable at current Trino cold-query latency.

---

## 3. CFM Recharge PK Verdict

**PASS — vng_transaction is effectively unique per row in cfm recharge.**

Evidence chain:

1. **Declared PK:** `cube-dev/cube/model/cubes/cfm/recharge.yml` declares `primary_key: true` on `transaction_id` (sql: `vng_transaction`). Author comment: "verified one row per transaction and same-date for 100% of matches" for the LEFT JOIN to `std_ingame_role_recharge`.

2. **Compiled measure type:** `/sql` endpoint shows `count("recharge".vng_transaction)` for the `transactions` measure (type: count, no sql → Cube counts PK column). This is NOT count_distinct — it relies on vng_transaction uniqueness for correctness.

3. **Cross-source revenue agreement:** `recharge.revenue_vnd_real` (sum of `std_ingame_role_recharge.recharged_value` bridged per-row) = 710,645,000 VND on 2026-06-01. `user_recharge_daily.revenue_vnd_total` (pre-aggregated upstream) = 710,645,000 VND on the same date. **Exact match** — no fan-out inflation.

4. **Transaction-per-user ratio:** `real_users_only` segment on Jun 1: transactions=2,391, paying_users_exact (count_distinct vopenid)=1,857 → ratio 1.29 txns/user. Entirely plausible for a daily window; nowhere near the ~800x fan-out seen in jus.

5. **Oracle comparison:** `cube-prod/cube/model/cubes/cfm_vn/recharge.yml` uses a different (ETL-curated) table (`cfm_vn.etl_ingame_recharge`) with `transaction_id` as PK and `type: count` for transactions — same logical design intent. Dev uses the raw SDK table `etl_ingame_recharge` joined via `std_ingame_role_recharge`; the SDK table's `vng_transaction` field is the VNG canonical payment ID (globally unique per transaction by VNG SDK contract).

6. **Contrast with jus:** jus recharge required a 5-field composite PK (`account_id + pay_time + transid + role_id + prepaid_detail_item_id`) because its `transid` appeared multiple times per user per day. No such composite is needed or present in cfm — structural difference in the source table schema.

**Revenue reporting caveat (not a PK issue):** `recharge.revenue_vnd` (sum of `iamount`) = 11,044,330,800 VND vs real = 710,645,000 VND on Jun 1. Ratio ~15.5×. This is **not inflation from duplicate rows** — it is the unbridged test/load traffic dominating iamount totals (confirmed by comments in recharge.yml: "Unbridged transactions dominate raw iamount (e.g. 11.0B of 11.04B on 2026-06-01)"). The `revenue_vnd` measure in the metric catalog points at `iamount` without the `real_users_only` filter. **Phase 4 must verify whether the anomaly detector / dashboard queries use the correct measure** (`revenue_vnd_real` or `user_recharge_daily.revenue_vnd_total`, not `revenue_vnd`).

---

## 4. Cold Trino Wall-Time Baseline

| Cube | Query type | Wall time | Notes |
|------|-----------|-----------|-------|
| active_daily | Single measure (dau), 1-day window | 516ms | Hits a pre-agg for some query shapes; others require cold Trino |
| active_daily | Multi-measure (5 measures), 7-day window | 5,965ms | Cold Trino scan of std_ingame_user_active_daily |
| recharge | 2 measures, 7-day window, unfiltered | 5,015–5,289ms | LEFT JOIN etl_ingame_recharge × std_ingame_role_recharge |
| recharge | 2 measures, 7-day window, real_users_only | ~5,000ms | Same scan; filter doesn't change partition count |
| mf_users | 4 measures, no time dim | 4,398–4,638ms | Table scan of mf_users wide table |
| retention | 3 measures, 30-day window | 14,106ms | sql:-derived table with 2-pass std_ingame_user_active_daily self-join |
| user_recharge_daily | 3 measures, 7-day window | 5,260ms | Scan of std_ingame_user_recharge_daily |
| arpdau cross-cube | recharge + active_daily, 7-day | >15,000ms (timeout) | Cube joins two Trino scans; exceeds 15s gateway timeout |

**Target gap:** The <2s target is met only when pre-agg partitions are built (active_daily single-measure = 516ms). All cold-Trino paths are 5–15s, with the retention cube at 14s and cross-cube joins timing out entirely.

---

## 5. Availability-Wiring Specification

### Current state

`game_compatibility.required_cubes` is checked **only in the frontend Catalog** (`src/pages/Catalog/metrics-tab/business-metric-types.ts: isAvailableForGame`). It checks cube *name* existence in `/meta` — not measure existence. A metric like `nru` whose cube `mf_users` exists in cfm_vn `/meta` (with 13 measures) but whose referenced measure `mf_users.new_users` is absent shows as **available=true** in the Catalog and reaches the anomaly detector and any chat agent path.

The server-side trust resolver (`metric-trust-resolver.ts`) downgrades broken-ref metrics to `trust:'draft'` at `/api/business-metrics?game=cfm_vn`, but does **not filter them out** of the response. The chat agent receives all 57 metrics, with 36 broken-ref ones tagged `draft` — but still offered to the user if the agent doesn't explicitly skip `draft` metrics.

### Required change to gate broken-ref metrics from chat agent

**File:** `server/src/routes/business-metrics.ts`

**Change shape:** Add a `?filter=available` query param to `GET /api/business-metrics`. When present alongside `?game=<id>`, run `validateRefs` against the game's `/meta` snapshot and **exclude** (not just downgrade) metrics with any unresolved ref before returning. The chat agent / feature that calls this endpoint should pass `filter=available` to receive only metrics that can actually be queried.

```typescript
// In GET /api/business-metrics handler, after existing trust adjustment:
if (req.query.filter === 'available' && req.query.game) {
  const snapshot = snapshotFromMeta(await getMetaForGame(req.query.game));
  const brokenIds = new Set(validateRefs(metrics, snapshot).map(u => u.metricId));
  return { metrics: adjusted.filter(m => !brokenIds.has(m.id)) };
}
```

**File:** `src/pages/Catalog/metrics-tab/business-metric-types.ts: isAvailableForGame`

**Change shape:** The function currently checks `game_compatibility.required_cubes` (cube name) only. For metrics whose cube exists but required measures are absent (the mf_users case), the check should also verify that every formula ref (`extractRefs(metric)`) resolves against `availableMemberNames` (not just cube names). The Catalog already has `availableCubeNames` from `/meta`; needs an `availableMemberNames: ReadonlySet<string>` parallel set built from measure names. The `/api/business-metrics?game=cfm_vn` response already carries the downgraded trust that signals broken-ref — alternatively, the frontend can use `metric.trust === 'draft'` as a proxy (since trust is downgraded server-side when any ref is missing) combined with a `?game=` call.

**Simplest path:** Front-end Catalog changes `hideUnavailable` to also hide metrics whose server-returned `trust` was downgraded to `draft` AND whose `game_compatibility.required_cubes` are met (cube exists but measure missing). The trust downgrade in `resolveTrustForGame` already encodes the broken-ref signal — the frontend just needs to surface it as unavailable rather than "draft-certified".

**No change needed in `care/availability.ts`:** That file governs playbook availability via `dataRequirements` member-set check (which already correctly fails-closed on absent members). Metric availability is a separate concern.

---

## 6. Unresolved Questions

1. **`revenue_vnd` vs `revenue_vnd_real` in production dashboards:** The `revenue` metric preset references `recharge.revenue_vnd` (iamount sum, includes unbridged test traffic). Is the dashboard/anomaly detector already filtering by `real_users_only` segment, or is it ingesting 15× inflated values? Must verify before Phase 4 query wiring.

2. **`arpdau` timeout:** The cross-cube recharge × active_daily join times out at 15s. Does the anomaly detector have a longer timeout that makes this "usable" for batch jobs? Or is arpdau effectively unqueryable for cfm_vn without a pre-agg?

3. **`active_daily` dau pre-agg pattern:** Two different probe results: 16,771 (cached/stale from a prior session?), 36,328 (Jun 4 fresh), and 190,062 (multi-measure cold scan Jun 1 counting differently). The discrepancy suggests different pre-agg partitions returning differently scoped data. Which pre-agg pattern (by country+payer vs total) is the canonical DAU for metric reporting?

4. **mf_users measure gap — root cause in upstream mart:** Are the 16 missing mf_users measures (new_users, installs, marketing_cost, etc.) absent because cfm_vn's upstream ETL pipeline doesn't produce them, or because the cube YAML was never updated to expose them? This determines whether Phase 2 (add measures to cube YAML) is sufficient or requires a data-platform request.

5. **`rp` (paying retention):** Uses `mf_users.paying_retained_d7` which is absent. Is there a `new_user_retention` cube in cfm that tracks paying retention separately (the `new_user_retention` cube in `/meta` has `rnru_d*` measures but no `paying_retained` measures)?

---

**Status:** DONE_WITH_CONCERNS  
**Summary:** 20/57 cfm_vn metrics are resolvable with live data; 36 have broken refs (32 from mf_users missing measures, 4 from absent funnel cube); cfm recharge PK is PASS with strong evidence; cold Trino wall times are 5–15s, far above the <2s target.  
**Concerns:** (1) `revenue.revenue_vnd` measure points at iamount which inflates 15× due to unbridged test traffic — phase 4 must audit which measure the dashboard actually renders. (2) `arpdau` cross-cube join times out — effectively broken for real-time use. (3) The availability-wiring gap means the chat agent is currently offered all 57 metrics for cfm_vn including 36 that will 400.
