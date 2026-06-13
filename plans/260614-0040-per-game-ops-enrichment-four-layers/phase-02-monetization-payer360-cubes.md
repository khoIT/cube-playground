# Phase 02 — Monetization / Payer-360 Cubes (P0, live — MVP, independently shippable)

## Context Links
- Bridge spec (input): `reports/bridge-spec-cfm-jus.md` (phase 1)
- Source report: `plans/reports/Explore-260614-0132-from-explore-to-planner-iceberg-monetization-schema-map-report.md`
- Shape reference (measures/dims to mirror, NOT port-as-is): existing dev cubes
  `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml` (pre-agg + lambda pattern),
  `cube-dev/cube/model/cubes/cfm/recharge.yml` (bridge + `real_users_only` pattern)
- Source tables (iceberg): `billing.std_billing_delivery_trans_gds` (transaction, 58.6M, LIVE hourly → `billing_detail`),
  `billing.pmt_users_history` (user×product_code lifetime, 18.5M, daily → `billing_lifetime` LTV cross-check)
- KEEP authoritative: `cube-dev/cube/model/cubes/{cfm,jus}/user_recharge_daily.yml` (ingame daily revenue) + `mf_users` LTV dims

## Overview
- **Priority:** P0 — the live monetization layer; the only family current to yesterday. **MVP — ships standalone;
  does NOT wait on the lagging CS / broad-identity layers.**
- **Status:** pending · **Depends on:** Phase 1.
- **Model decision (user-confirmed 2026-06-14):** KEEP existing + ADD enrichment, do NOT duplicate.
  - **KEEP** the existing `cube-dev/cube/model/cubes/{cfm,jus}/user_recharge_daily.yml` as the AUTHORITATIVE per-game
    DAILY revenue source (ingame delivery), and KEEP `mf_users` LTV dims. No duplicate daily-payer cube is built
    (resolves red-team #9 — there is no `payer_daily` rival cube).
  - **ADD** a `billing_detail` cube from `iceberg.billing.std_billing_delivery_trans_gds` (txn grain, hourly-fresh)
    exposing only the breakdown dims that `game_integration`/ingame LACKS: payment method/gateway/partner/provider,
    item, store, charged-vs-delivered amounts, and PROMO fields. This is ADDITIVE enrichment, not a revenue replacement.
  - **ADD** a `billing_lifetime` cube from `iceberg.billing.pmt_users_history` (user×product lifetime) used as a
    canonical-billing LTV cube to CROSS-CHECK / reconcile against the ingame `mf_users` LTV — NOT to override it.
- **Canonical revenue stays ingame:** `user_recharge_daily.revenue_vnd` (delivery) is the headline number; billing
  amounts (gateway cash) are enrichment. A REQUIRED reconciliation probe reports the gateway-vs-delivery gap and its
  cause — it does NOT switch the canonical source (the two measure different funnel points, so a gap is expected).

## Key Insights
- `std_billing_delivery_trans_gds` is the freshest billing source (hourly) at TRANSACTION grain. `billing_detail`
  aggregates to `user_id × CAST(order_created_datetime AS DATE) × breakdown-dim` in the cube `sql:`. Tag `[freshness: live]`.
- **`user_id` IS the GDS snowflake** (phase-1 verified) → joins `mf_users.user_id` DIRECTLY, no translation table.
  Each billing cube `sql:` filters on the game's product_code set (cfm: `A49`,`267`; jus: `A70`) AND requires a matched
  `mf_users.user_id` (the `real_users_only`-equiv filter) — this pair is the game-isolation.
- **Breakdown dims billing ADDS that ingame LACKS** (the whole reason for `billing_detail`): `payment_gateway`,
  `payment_partner_id`, `payment_method_id`, `payment_provider_id`; item (`item_id`/`item_name`/`item_type`,
  `item_price`); `store`; charged-vs-delivered amounts (`payment_charged_amount`, `lps_charged_amount`,
  `wallet_charged_amount`, `product_delivered_amount`, `wallet_delivered_amount`); promo (`promotion_type`,
  `promotion_trans_id`, `promotion_charged_amount`).
- **`real_users_only`-equiv filter is MANDATORY** (red-team #8): without it, unbridged/foreign-format/dummy user_ids
  inflate revenue ~100x (`recharge.yml:11-21`). Every billing cube requires a matched mf_users user_id; ground-truth
  (phase 8) compares WITH the filter on.
- **Game-isolation is NOT free from folder placement** (red-team #1): the billing table holds every game's rows; the
  product_code filter + matched-user_id join is what scopes it. Do NOT rely on the cube living in `cubes/cfm/`.
- **No duplicate of `user_recharge_daily`** (resolves red-team #9): we KEEP that cube as the authoritative daily revenue
  source and do NOT build a rival daily-payer cube. `billing_detail` is a different grain/purpose (method/promo/cash
  breakdown), not a re-aggregation of the same number. A REQUIRED reconciliation probe (below) reports the
  gateway-charged vs ingame-delivered gap — it does NOT fold or replace either cube.
- **Canonical = ingame delivery, billing = enrichment:** `user_recharge_daily.revenue_vnd` (delivery) is the headline
  revenue; `billing_detail.payment_charged_amount` (gateway cash) is enrichment. They measure DIFFERENT funnel points
  (cash charged at gateway vs value delivered in-game) so a gap is EXPECTED, not a bug — never switch the canonical
  source to billing.
- **Promo-aware ARPU is IN SCOPE this round** (user-confirmed): `billing_detail` models the `promotion_type` dim plus
  promo-charged vs cash-charged measures so ARPU can be decomposed by promo. Because this is txn grain it fans out →
  pre-aggregate per the existing lambda pattern (phase 8) and register with the big-cube scan guard if it qualifies
  (red-team #6, `cube.js:91-120`).
- **Gross revenue only** (red-team #4): no refund/chargeback table in iceberg. Name revenue measures `*_gross`;
  document the gap; do NOT claim "net". Lifetime table confirmed = `pmt_users_history` (`total_amt_vnd/usd`,
  `total_trans`, `first_/last_date`) → drives the `billing_lifetime` cross-check cube.

## Requirements
- Functional (KEEP): existing `user_recharge_daily.yml` (cfm, jus) unchanged as authoritative daily revenue; `mf_users`
  LTV dims unchanged.
- Functional (ADD `billing_detail`): per game, txn→user×day×breakdown cube from `std_billing_delivery_trans_gds`
  exposing the dims ingame lacks — payment method/gateway/partner/provider, item, store, charged-vs-delivered amounts,
  and promo (`promotion_type` dim + `promotion_charged_amount`). Promo-aware ARPU: promo-charged vs cash-charged measures.
- Functional (ADD `billing_lifetime`): per game, user×product lifetime cube from `pmt_users_history`
  (first/last order date+time+amt, total_trans, total_amt_vnd/usd) used to CROSS-CHECK ingame mf_users LTV.
- Non-functional: single-user query latency comparable to existing recharge cubes; `billing_detail` is txn grain →
  pre-agg in phase 8 (lambda pattern) + big-cube guard registration if it qualifies.

## Architecture
- **Canonical revenue stays `user_recharge_daily`** (ingame delivery). Billing cubes are ADDITIVE enrichment.
- Data flow (`billing_detail`): `iceberg.billing.std_billing_delivery_trans_gds` → cube `sql:` (filter product_code set
  + matched mf_users user_id + aggregate to user×day×breakdown) → join `mf_users` on `user_id` (many_to_one) → measures
  (gateway-charged sum, delivered sum, wallet sums, promo-charged sum, cash-charged sum, paying-user
  count_distinct_approx) + breakdown dims (payment method/gateway/store/item/promotion_type) + recency/tier dims.
- Data flow (`billing_lifetime`): `iceberg.billing.pmt_users_history` → cube `sql:` (filter product_code set + matched
  user_id) → join `mf_users` on `user_id` → lifetime measures (total_amt_vnd/usd, total_trans, lifetime ARPPU) +
  first/last cohort dims. Purpose: reconcile against ingame mf_users LTV.
- **Game-scope is the product_code filter + matched user_id, NOT folder placement.** The billing table is cross-game;
  each cube must filter `product_code IN (<game's codes>)` and require a matched `mf_users.user_id`. The per-game Trino
  schema is resolved by cube.js driver config; the iceberg ref is fully-qualified (cross-catalog).
- Logical names from phase 1 → member-resolver consistency on prefix workspace.

## Related Code Files
- KEEP unchanged (authoritative daily revenue): `cube-dev/cube/model/cubes/{cfm,jus}/user_recharge_daily.yml`,
  and `mf_users` LTV dims.
- Create: `cube-dev/cube/model/cubes/cfm/billing_detail.yml`, `.../jus/billing_detail.yml`
- Create: `cube-dev/cube/model/cubes/cfm/billing_lifetime.yml`, `.../jus/billing_lifetime.yml`
- Read: existing `user_recharge_daily.yml`, `recharge.yml`; monetization schema-map report

## Implementation Steps
1. From phase-1 spec, lift the product_code set + confirmation that `user_id` joins mf_users directly (cfm, jus).
2. **Reconciliation probe (REQUIRED, does NOT change canonical):** for a known user/day per game, compare billing
   `payment_charged_amount` (gateway cash) vs ingame `user_recharge_daily.revenue_vnd` (delivery). REPORT the gap and
   its cause; note the two measure different funnel points so a gap is EXPECTED. Do NOT switch the canonical source.
   Separately, cross-check `billing_lifetime.total_amt_vnd` vs mf_users ingame LTV for the same users; report drift.
3. Author `billing_detail.yml` (cfm, jus): cube `sql:` filters product_code set + matched mf_users user_id + aggregates
   to user×day×breakdown; join mf_users many_to_one on user_id; dims (user_id, log_date time-dim, payment_gateway,
   payment_partner_id, payment_method_id, payment_provider_id, item_id/name/type, item_price, store, promotion_type,
   recency band, payer tier); measures (charged/delivered/wallet sums named `*_gross`, `promo_charged_gross`,
   `cash_charged_gross`, `paying_users` count_distinct_approx). `refresh_key: every: 30 minute`. Description starts
   `[freshness: live]`. Mandatory matched-user_id filter. Pass user_id equality for 1-user latency.
4. Author `billing_lifetime.yml` (cfm, jus) from `pmt_users_history` (lifetime grain: first/last date+time+amt,
   total_trans, total_amt_vnd/usd, lifetime ARPPU). Filter product_code set + matched user_id; join mf_users on user_id.
   `[freshness: live]` (pmt_users_history is daily-fresh). Purpose tag: canonical-billing LTV cross-check vs ingame LTV.
5. Compile-check in ISOLATION first (one bad YAML fails the whole game model — cube.js:348-350). Then trigger model
   reload, hit `/meta?extended=true` with `x-cube-game: cfm` then `jus`; confirm new cubes present and only the active
   game's rows return on a probe query (game-isolation re-verified at runtime).

## Todo List
- [ ] Reconciliation probe: billing gateway-charged vs ingame delivered (report gap + cause; canonical stays ingame)
- [ ] LTV cross-check: billing_lifetime total_amt vs mf_users ingame LTV (report drift)
- [ ] billing_detail.yml (cfm, jus) — product_code + matched-user_id filter + breakdown dims + promo measures + freshness:live
- [ ] billing_lifetime.yml (cfm, jus) — lifetime from pmt_users_history + freshness:live (cross-check purpose)
- [ ] user_recharge_daily.yml KEPT unchanged (authoritative daily revenue) + mf_users LTV dims KEPT
- [ ] Game-isolation verified at runtime (only active game's rows)
- [ ] Compile (isolated) + per-game /meta verification
- [ ] Single-user latency sanity check

## Success Criteria
- `billing_detail` + `billing_lifetime` compile under BOTH cfm and jus, browsable in `/meta`; `user_recharge_daily`
  unchanged and still authoritative.
- A user_id-filtered query returns only that game's rows (product_code + matched-user_id scoped); match-rate matches phase-1.
- **Reconciliation probe ran and its output is recorded** — gateway-charged vs ingame-delivered gap + cause reported;
  canonical source UNCHANGED (still ingame). LTV cross-check drift reported.
- Promo decomposition works: ARPU splittable by `promotion_type`; promo-charged vs cash-charged measures present.
- Only gross revenue exposed; descriptions carry freshness tier; net-revenue gap documented; no duplicate of
  `user_recharge_daily`.

## Risk Assessment
- **Transaction-grain fan-out inflates measures** (Med×High): `billing_detail` aggregates to user×day×breakdown in cube
  SQL; verify a known user's daily total vs raw; pre-agg (phase 8) + big-cube guard if it qualifies.
- **Misreading billing as canonical revenue** (Med×High): a stakeholder treats gateway-charged as the headline number.
  Mitigate: canonical stays `user_recharge_daily`; reconciliation probe documents WHY the two differ (different funnel
  points: cash charged vs value delivered).
- **Missing matched-user_id filter** (High×High): ~100x inflation. Mitigate: mandatory filter on both billing cubes;
  phase-8 ground-truth WITH it.
- **No net revenue** (Low×Med): stakeholders assume net. Mitigate: explicit `_gross` naming + description caveat.

## Security Considerations
- Gross VND/USD only; no raw payer PII (no msisdn/email/payment-account dims public).
- Cube `sql:` uses `order_created_datetime`/partition columns for prune.

## Code-comment / naming rule
- YAML cube names + comments MUST NOT reference plan-artifact labels (phase numbers, red-team finding codes). Explain
  the WHY instead — e.g. comment the reconciliation measure as "gateway-charged vs delivered amounts diverge because
  they measure different funnel points (cash charged at gateway vs value delivered in-game)", and the matched-user_id
  filter as "exclude unbridged/dummy user_ids that otherwise inflate gross revenue ~100x". File names use domain slugs
  (`billing_detail.yml`, `billing_lifetime.yml`), never phase/finding labels.
