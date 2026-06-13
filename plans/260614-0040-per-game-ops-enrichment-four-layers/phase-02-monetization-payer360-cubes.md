# Phase 02 — Monetization / Payer-360 Cubes (P0, live)

## Context Links
- Bridge spec (input): `reports/bridge-spec-cfm-jus.md` (phase 1)
- Prod oracle to port: `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/jus_vn/user_recharge_daily.yml`,
  `.../jus_vn/recharge.yml`, `.../vga/vga_payment_history.yaml`
- Existing dev cubes to mirror: `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml` (pre-agg + lambda pattern),
  `cube-dev/cube/model/cubes/cfm/recharge.yml` (bridge pattern)
- Source tables: `billing.pmt_user_daily` (LIVE, ~35.5M), `billing.mf_payment_user_history` (lags 2026-01),
  `payment.pmt_billing_ff_callback_trans` (per order, 2026-04)

## Overview
- **Priority:** P0 — the live monetization layer; the only family current to yesterday.
- **Status:** pending · **Depends on:** Phase 1.
- **Description:** Author three game-scoped monetization cubes per game (cfm, jus): a LIVE payer-daily cube
  backed by `pmt_user_daily`, a lifetime payment-history cube backed by `mf_payment_user_history` (lagging),
  and (optionally) a payment-callback funnel cube backed by callback logs (lagging). Add payer LTV-tier +
  recency dims. Existing `recharge` / `user_recharge_daily` cubes stay — these ADD the cross-cutting billing source.

## Key Insights
- `pmt_user_daily` is the loop linchpin: user × product × day, LIVE to yesterday, `npu/dpu/trans/rev_vnd/rev_usd/
  first_payment_date/bundle_code`. This is the freshest revenue source — tag `[freshness: live]`.
- It is user×product×day grain (1:N per user) → join to mf_users many_to_one; pre-aggregate (phase 8) for scans.
- Identity: `pmt_user_daily.user_id` format varies — phase-1 bridge spec dictates the exact key (prefer vga_id
  where populated). Bridge SQL goes in the cube `sql:` block (recharge.yml pattern), NOT in app code.
- Net-revenue is NOT computable: no refund/chargeback source confirmed (report unresolved Q1). Expose GROSS
  revenue only; name measures `revenue_vnd_gross`; document the gap in description — do not claim "net".
- `pmt_user_daily.npu/dpu` semantics unconfirmed (unresolved Q10) — do NOT surface as headline measures until
  semantics verified in phase 1; expose as `public: false` or with a caveat in description.

## Requirements
- Functional: per game, cubes `payer_daily` (live), `payment_history` (lifetime, lagging),
  optional `payment_callback` (funnel/provider health, lagging). Each joins mf_users via the phase-1 key.
- Payer dims: LTV tier (reuse mf_users `payer_tier` taxonomy whale/dolphin/minnow/non_payer for consistency),
  recency band (days since last payment), first-payment cohort.
- Non-functional: single-user query latency comparable to existing recharge cubes; pre-agg deferred to phase 8.

## Architecture
- Data flow: Trino `billing.pmt_user_daily` → cube SQL (bridge to gds_user_id per phase-1) → join mf_users
  (many_to_one) → measures (gross rev sum, paying-user count_distinct_approx, ARPPU) + recency/tier dims.
- Files live in `cubes/cfm/` and `cubes/jus/` → game-scoped for free; cross-game leak impossible (each compiles
  only into its own model). The per-game schema (`cfm_vn`/`jus_vn`) is resolved by cube.js driver config, NOT hardcoded.
- Logical names from phase 1 → member-resolver consistency on prefix workspace.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/payer_daily.yml`, `cube-dev/cube/model/cubes/jus/payer_daily.yml`
- Create: `cube-dev/cube/model/cubes/cfm/payment_history.yml`, `cube-dev/cube/model/cubes/jus/payment_history.yml`
- Create (optional, if bridge resolves): `cube-dev/cube/model/cubes/cfm/payment_callback.yml`, `.../jus/payment_callback.yml`
- Read: prod oracle YAMLs above; `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml`, `.../cfm/recharge.yml`

## Implementation Steps
1. From phase-1 spec, lift the exact join key + bridge SQL for pmt_user_daily (cfm, jus).
2. Author `payer_daily.yml`: `sql:` with bridge → join mf_users; dims (user_id, log_date time-dim, product/bundle,
   recency band, payer tier); measures (`revenue_vnd_gross` sum, `paying_users` count_distinct_approx, ARPPU).
   `refresh_key: every: 30 minute`. Description starts `[freshness: live]`. Pass user_id equality for 1-user latency.
3. Author `payment_history.yml` from `vga_payment_history.yaml` (lifetime grain, first/last month, lifetime trans/VND/USD,
   ARPPU lifetime). Description `[freshness: lagging]` (source lags to 2026-01).
4. If phase-1 resolved callback id: author `payment_callback.yml` at per-order grain (is_success/provider/latency).
   Description `[freshness: lagging]`. Else skip + note follow-up.
5. Mark npu/dpu per phase-1 semantics finding (public:false or caveated).
6. Compile-check: trigger model reload, hit `/meta?extended=true` with `x-cube-game: cfm` then `jus`, confirm new
   cubes present and only the active game's rows return on a probe query.

## Todo List
- [ ] payer_daily.yml (cfm, jus) with phase-1 bridge + gross-rev measures + freshness:live tag
- [ ] payment_history.yml (cfm, jus) lifetime + freshness:lagging tag
- [ ] payment_callback.yml (cfm, jus) IF bridge resolves, else note follow-up
- [ ] npu/dpu handled per semantics finding
- [ ] Compile + per-game /meta verification
- [ ] Single-user latency sanity check

## Success Criteria
- New monetization cubes compile under BOTH cfm and jus, browsable in `/meta`.
- A user_id-filtered query returns only that game's rows; match-rate matches phase-1 measurement.
- Only gross revenue exposed; descriptions carry freshness tier; net-revenue gap documented.

## Risk Assessment
- **pmt_user_daily fan-out via product grain** (Med×High): mis-modeled join inflates revenue. Mitigate: many_to_one
  to mf_users + measures aggregate at user grain; verify a known user's daily total vs raw.
- **npu/dpu misuse** (Med×Med): unverified semantics surfaced as truth. Mitigate: gate behind phase-1 finding.
- **No net revenue** (Low×Med): stakeholders assume net. Mitigate: explicit `_gross` naming + description caveat.

## Security Considerations
- Gross VND/USD only; no raw PII. Bridge SQL uses partition columns (log_date) for prune.
- Keep callback-log provider/method fields aggregate; no raw payer PII (msisdn/email) in any dim.
