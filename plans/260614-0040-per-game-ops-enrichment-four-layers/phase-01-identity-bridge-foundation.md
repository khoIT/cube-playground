# Phase 01 — Identity-Bridge Foundation (dependency root)

## Context Links
- Source reports (iceberg, supersede the old stag_iceberg scout):
  `plans/reports/Explore-260614-0132-from-explore-to-planner-iceberg-monetization-schema-map-report.md`,
  `plans/reports/Explore-260614-1340-iceberg-identity-behavior-schema-map-report.md`,
  `plans/reports/from-explore-to-planner-iceberg-cs-platform-schema-map-report.md`
- Pattern to copy: `cube-dev/cube/model/cubes/cfm/recharge.yml:42-63` (bridge SQL in cube `sql:` block)
- `real_users_only` precedent: `cube-dev/cube/model/cubes/cfm/recharge.yml:11-21`
- Trino client: `cube-dev/examples/trino_q.py` (fully-qualify `iceberg.<schema>.<table>`)
- Spine: `cube-dev/cube/model/cubes/cfm/mf_users.yml`, `cube-dev/cube/model/cubes/jus/mf_users.yml`

## Overview
- **Priority:** P0 — blocks phases 2–5. No cube is authored until its join key passes the GO/NO-GO gate.
- **Status:** pending
- **Description:** For cfm + jus, (1) resolve the game's product_code(s) from `iceberg.mdm.map_product_code`,
  (2) empirically probe each iceberg source table's join to `mf_users.user_id` (GDS snowflake) and measure the
  match-rate, (3) prove game-isolation (no other game's rows leak), (4) record per-table freshness from iceberg,
  (5) confirm the Trino driver can read `iceberg.*` cross-catalog. Output = a per-table **bridge spec** that is the
  input contract for phases 2–5. **Scope the MVP bridges first** (billing payer, etl_user_profile geo,
  vga lifecycle, cs_ticket) so the monetization layer can ship before the lagging layers are probed.

## Key Insights (iceberg, partially probed 2026-06-14)
- **`billing.std_billing_delivery_trans_gds.user_id` IS the GDS snowflake** (verified sample:
  `3371487000975204352`, same scale as mf_users) → joins `mf_users.user_id` DIRECTLY, no translation table.
  A minority of short/foreign-format user_ids won't match → REQUIRE a `real_users_only`-equiv filter.
- **product_code resolution (probed):** cfm = **`A49`** (cfmvn) AND **`267`** (cfmobile) — cfm spans TWO codes;
  jus = **`A70`** (jusvn). Phase-1 output must list ALL of a game's product_codes; cubes filter on the set.
- **CS namespace caveat (probed):** `cs_ticket.customers_v2.product_id` uses `267` for cfm — DIFFERENT value from
  billing's `A49`. The CS bridge is `cs_ticket_info.customer_id → customers_v2.product_id → game` (99.9% match,
  per CS report) — NOT the billing product_code. Phase 1 reconciles BOTH product_code namespaces → game.
- **Identity tables key on `(game_id, user_id)` directly** (`gds_da.etl_user_profile`,
  `vga.std_all_game_user_profile`, `vnggames.std_user_profile`) — user_id is the snowflake. Join on
  `(game_id constant + user_id)` to mf_users. Do NOT route through `vga_id` (a DIFFERENT M:N namespace).
- Bridge must be PROVEN, not assumed: a wrong key silently zero-matches (looks empty) OR fans out (inflates) OR
  leaks another game's rows. Game-isolation is part of the proof, not just match-rate.

## Requirements
- Functional: for the MVP tables `{billing.std_billing_delivery_trans_gds, billing.pmt_users_history,
  gds_da.etl_user_profile, vga.std_all_game_user_profile, cs_ticket.cs_ticket_info + customers_v2}` × {cfm, jus},
  resolve + document: product_code(s)/game scope, join key to mf_users, match-rate, grain proof, game-isolation
  proof, iceberg freshness max-date. Then (deferred-tier) `cs_ticket_logs`, `cs_rating_processes`, `pmt_users_monthly`.
- Non-functional: each bridge cites the verification SQL + observed match-rate (% of source rows resolving to a real
  mf_users.user_id, AFTER product_code/game filter) and grain proof (rows per join key ≤ expected).

## Architecture
- Discovery only — NO cubes authored. Data flow: `iceberg.mdm.map_product_code` → game product_code set; then
  per table: Trino `DESCRIBE` + sample + COUNT/match-rate/isolation queries → bridge-spec markdown.
- **Catalog reachability check:** confirm the Cube Trino driver reads `iceberg.*` from the `game_integration`
  session (cross-catalog works — `cube/model/_shared/segment_membership.yml:15-16`; introspection already
  succeeded). Record the confirmation as a check so cube authors trust 3-part refs.
- member-resolver impact: decide the LOGICAL cube name per table (`billing_detail`, `billing_lifetime`, `user_geo`,
  `lifecycle_profile`, `cs_ticket_detail`; existing `user_recharge_daily` stays the authoritative daily revenue cube).
  Passthrough on `local`; record for prefix (prod) consistency. Do NOT register physical joins in app code.

## Related Code Files
- Read (context): `cube-dev/cube/model/cubes/cfm/recharge.yml`, `.../cfm/mf_users.yml`, `.../jus/mf_users.yml`,
  `cube-dev/examples/trino_q.py`
- Create: `plans/260614-0040-per-game-ops-enrichment-four-layers/reports/bridge-spec-cfm-jus.md` (per-table bridge spec)
- Modify: none (discovery phase)

## Implementation Steps
1. **Reachability + scope:** run `trino_q.py "SELECT product_code, game_id, gds_bundle_code FROM iceberg.mdm.map_product_code WHERE ..."`
   to confirm `iceberg` reachable and list cfm (A49, 267) + jus (A70) product_codes. Confirm the same driver/user the
   Cube serving instance uses can read `iceberg.*` (cross-catalog).
2. For each MVP table: `DESCRIBE` + 3-row sample + max-date freshness check (all 3-part `iceberg.*`).
3. **Match-rate probe** against the game's `mf_users`, AFTER filtering to the game's product_code(s)/game_id:
   `SELECT count(*) total, count(mu.user_id) matched FROM <iceberg table> t [game/product filter] LEFT JOIN mf_users mu ON t.user_id = mu.user_id`
   (billing/identity: direct snowflake; CS: via `customer_id → customers_v2.product_id`). Report the %.
4. **Game-isolation proof:** confirm the product_code/game_id filter leaves ONLY this game's rows
   (`SELECT count(DISTINCT product_code)` post-filter = the game's set; no foreign product_code leaks).
5. **Grain proof:** `SELECT <key>, count(*) ... GROUP BY 1 ORDER BY 2 DESC LIMIT 5` — user-grain tables 1:1,
   txn/event tables 1:N (flag for separate-grain + pre-agg in phase 8).
6. Record freshness tier per table (live / lagging) from max-date.
7. Write `bridge-spec-cfm-jus.md`: one section per table with product_code set, join key, bridge SQL (trivial for
   billing — direct), match-rate, game-isolation result, grain, freshness, logical cube name. **GO/NO-GO:** mark any
   table whose match-rate < 70% (or whose isolation cannot be proven) as BLOCKED — its cube is dropped this round
   (documented), with the fallback noted (monetization falls back to the existing `user_recharge_daily` cube).

## Todo List
- [ ] Confirm `iceberg` reachable from Cube's Trino driver + cross-catalog ref works
- [ ] Resolve cfm (A49, 267) + jus (A70) product_code set from `mdm.map_product_code`
- [ ] DESCRIBE + sample + freshness for MVP tables (billing, etl_user_profile, vga profile, cs_ticket)
- [ ] Match-rate probe each (post game/product filter) → record %
- [ ] Game-isolation proof per table (no foreign product_code leaks)
- [ ] Grain proof per table
- [ ] Assign logical cube names
- [ ] Write bridge-spec-cfm-jus.md with GO/NO-GO (≥70% else BLOCKED) + fallback
- [ ] (Deferred tier) probe cs_ticket_logs / cs_rating_processes / pmt_users_monthly

## Success Criteria
- Every MVP table has a documented join path with a MEASURED match-rate (not assumed), a game-isolation proof, and a
  grain proof.
- `iceberg` catalog reachability + cross-catalog ref confirmed (cube authors can trust 3-part refs).
- Tables with match-rate < 70% or unprovable isolation flagged BLOCKED (cube dropped + fallback documented).
- Logical cube names assigned for member-resolver consistency.

## Risk Assessment
- **Wrong key / unscoped join** (High×High): silent zero-match, fan-out, OR cross-game leak. Mitigate: empirical
  match-rate + grain + game-isolation probe is the gate.
- **CS product_id ≠ billing product_code** (Med×High): reconciling the two namespaces wrong scopes CS to the wrong
  game. Mitigate: explicit reconciliation in step 4; CS scope is `customer_id→customers_v2.product_id`, not billing's.
- **cfm multi-product_code (A49 + 267)** (Med×Med): filtering on only one undercounts cfm. Mitigate: cube filters on
  the full set from step 1.
- **Trino cold-scan slow on big tables** (Med×Med): use partition columns (order_created_datetime / run_date / ds) in
  every probe.

## Security Considerations
- Read-only Trino introspection. Do NOT copy raw PII (phone/email/IP/device/idfa) into the spec — record column NAMES
  + match-rates only. The identity report flags PII cols on `etl_sdk_login` (IP/device/idfa) and `vga.*_pii`
  (name/phone/email) → mark `public:false` in the consuming cubes.
- Bridge SQL must use partition columns to avoid full-table scans of 100M+ row tables.
