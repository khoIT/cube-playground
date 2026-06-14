# Bridge Spec — cfm + jus (Phase 1 GO/NO-GO output)

Empirically probed against Trino `iceberg.*` (cross-catalog from `game_integration` session) on 2026-06-14.
This is the input contract for Phases 2–5. Every number below is measured, not assumed.

## Reachability + product_code resolution

- `iceberg` is reachable from the Cube Trino driver/user (`gds_da`); cross-catalog 3-part refs work.
- `iceberg.mdm.map_product_code`: cfm → `A49` (game_id `cfmvn`, bundle `cfm_vn`) **and** `267` (game_id
  `cfmobile`, **empty** bundle); jus → `A70` (game_id `jusvn`, bundle `jus_vn`).

### ⚠️ Refinement vs plan: cfm billing scope = **A49 only** (drop 267)
`267`/cfmobile is a **dead legacy product**: 0 billing rows in the last 365 days; `pmt_users_history` shows its
last activity `2026...`→ actually `2020-09-14`. Its 107k lifetime rows almost never match the current `cfm_vn`
mf_users (they're cfmobile-era users), dragging cfm lifetime match to 78.1%. **A49 alone = 99.99%.** Because the
mandatory matched-user_id filter drops 267 orphans anyway, cfm cubes scope on **A49 only** (267 documented dead;
re-add only if cfmobile is ever onboarded). jus = `A70`.

## Layer-by-layer GO/NO-GO

| Cube | Source (iceberg) | Game scope | Match→mf_users | Grain | Freshness (max date) | Verdict |
|------|------------------|-----------|----------------|-------|----------------------|---------|
| `billing_detail` | `billing.std_billing_delivery_trans_gds` | `product_code` = A49 (cfm) / A70 (jus) | **cfm 100.0%, jus 100.0%** (35d) | txn 1:N (max 289/user, avg 4.6 → aggregate in cube SQL) | **LIVE** (2026-06-13 20:01 UTC, hourly) | **GO** |
| `billing_lifetime` | `billing.pmt_users_history` | `product_code` = A49 / A70 | **cfm 99.99% (A49), jus 94.3%** | 1:1 (user × product_code) | **LIVE** (last_date 2026-06-14, daily) | **GO** |
| identity (`user_profile`) | `vga.std_all_game_user_profile` | `game_id` = `cfm_vn` / `jus_vn` | **cfm 100.0%, jus 91.6%** | **1:1** per (game_id,user_id) | **LAGGING ~29d** (`__ver`/register/install max **2026-05-17**) | **GO, lagging** |
| `user_geo` LIVE (planned src) | `gds_da.etl_user_profile` | `game_id` | **0% — table only has `bum`+`thiennu3`** | — | — | **BLOCKED (no cfm/jus)** |
| `cs_ticket_detail` | `cs_ticket.cs_ticket_report` (+ `customers_v2`) | `product_code` = A49 / A70 (=product_id 856/832) | **game-scope 100%**; member→mf_users **cfm 23.3%, jus 9.5%** | ticket ~1:1 (136,082 rows / 133,636 tickets → dedup to PK ticket_id) | **~LIVE/lagging** (created 2026-06-13, ~1-day) | **GO (game-aggregate); member-join best-effort/LOW** |

`vnggames.std_user_profile`: **0 rows** for cfm/jus → not a source.

## Per-cube bridge SQL contract

### billing_detail / billing_lifetime (monetization MVP — GO)
- `user_id` IS the GDS snowflake → **direct** `t.user_id = mf_users.user_id` join (no translation table).
- Scope: `WHERE product_code = 'A49'` (cfm) / `'A70'` (jus) **AND** matched mf_users user_id (`real_users_only`-equiv,
  excludes unbridged/dummy ids that otherwise inflate gross ~100x).
- **jus is mixed-currency (USD + VND); cfm A49 is VND-only.** `std_billing_delivery_trans_gds` has a `currency`
  column + per-currency `*_charged_amount`/`*_delivered_amount` (in txn currency). `pmt_users_history` carries
  pre-normalized `total_amt_vnd` AND `total_amt_usd`. → jus monetization measures MUST be currency-aware
  (separate VND/USD measures or a `currency` dim); never sum across currencies blindly.
- Breakdown dims billing adds that ingame lacks: `payment_gateway`, `payment_partner_id`, `payment_method_id`,
  `payment_provider_id`, `item_id/name/type/price`, `store`, charged-vs-delivered amounts, promo
  (`promotion_type`, `promotion_charged_amount`). Gross only (no refund table anywhere).

### identity `user_profile` (GO, lagging) — consolidated from two planned cubes to one
- `etl_user_profile` (the planned LIVE geo source) **does not contain cfm/jus** → the two planned identity cubes
  (`user_geo` LIVE + `lifecycle_profile`) **collapse into ONE** cube sourced from `vga.std_all_game_user_profile`.
- Scope: `WHERE game_id = 'cfm_vn'` / `'jus_vn'`; join `t.user_id = mf_users.user_id` (1:1).
- Carries geo (`first/last_country_code`, `countries`), lifecycle (install/register/login/charge times,
  `last_active`), login channels, acquisition (`media_source`, `campaign_id`), `user_type`.
- **Tag `[freshness: lagging]`** — load stopped ~2026-05-17 (~29d stale); churn-gap dims are ~1 month behind.
- PII `public:false`: `device_id`, `install_id`, `fb_emails`.

### cs_ticket_detail (GO for game-aggregate; member-join LOW)
- Game scope: `cs_ticket_report.product_code = 'A49'`/`'A70'` (100% reliable; product_id 856=cfm, 832=jus).
- Dedup to PK `ticket_id`. Rich dims: `ticket_status`, `resolution_time`, sentiment, `ticket_rating`/CSAT,
  `vip_id`, `dept`/`pillar`/`ticket_type`/`category`/`ticket_source`, `country_code`.
- Member join (for member360/segments): `cs_ticket_report.customer_id → customers_v2.customer_id`
  (filter `customers_v2.product_id` = 856/832) `→ customers_v2.user_id → mf_users.user_id`.
  **Coverage is LOW: cfm 23.3%, jus 9.5%** of tickets resolve to an mf_users member (ticket-filers skew toward
  identities absent from mf_users — not a small-spine artifact; mf_users is cfm 7.18M / jus 1.92M users).
- PII `public:false`: `staff_id`, `staff_domain`, `created_by`; `customers_v2.login_info`/`social_id`.

## Material refinements the build must honor (deviate from plan text — see GO/NO-GO summary to user)
1. **cfm billing = A49 only** (267 dead since 2020).
2. **jus billing is mixed USD+VND** → currency-aware measures (cfm VND-only).
3. **Identity LIVE source unavailable** → ONE lagging identity cube from vga (not two; no LIVE geo cube this round).
4. **CS product_id = 856 (cfm) / 832 (jus)**, NOT 267; `product_code` A49/A70 also scopes (aligns billing).
5. **CS member-level coverage is LOW (23.3% / 9.5%)** → CS cube ships for game-aggregate analytics; member360
   "this player's tickets" will be sparse; `unresolved_share` measure surfaces this honestly.

## Phase 2 reconciliation result (probe ran 2026-06-14, recorded per success criterion)

Known cfm payer `3434342640331046912` (Apple Store Gateway):
- **Daily:** billing gateway-charged 11,295,000 VND on 2026-06-13; `user_recharge_daily` had **no row yet** for
  that day → **billing is fresher than ingame delivery** (ingame daily lags ~1 day). Expected.
- **Lifetime:** billing `pmt_users_history` total = **88,214,000 VND** (31 txns) vs ingame mf_users LTV
  **49,430,000 VND** → gateway ≈ **1.78× ingame**. Driver: **Apple Store Gateway** — charged cash (Apple
  pricing + 30% cut) structurally exceeds ingame-delivered VND value. **Not a join bug** (`billing_lifetime` is
  1-row-per-user upstream-aggregated; verified via Cube `/load` = same 88,214,000, no fan-out).
- **Decision unchanged:** canonical revenue stays ingame `user_recharge_daily`; billing is enrichment. The gap is
  a funnel/pricing difference (gateway cash vs delivered value), sanity-bounded (~1.8×, store-pricing-driven).

Cube build verification: both `billing_detail` + `billing_lifetime` **compile** under cfm (52 cubes) and jus
(29 cubes) with no model break, and **execute end-to-end via Cube `/load`** (game-isolated, currency-aware).

## CS — impact on the existing Care360 join (reconciliation)

The existing Care tab uses `server/src/lakehouse/cs-ticket-reader.ts` (reads `cs_ticket_info`, joins
`split_part(user_id,'@',1)` → segment member uid). Measured apples-to-apples on cfm (180d):

| Path | Source | Member match | Ceiling cause |
|------|--------|--------------|---------------|
| EXISTING reader | `cs_ticket_info.user_id` split `@` | **24.3%** | FB/AIHelp PSID unjoinable |
| NEW cube (this plan) | `customer_id → customers_v2 → user_id` | **23.3%** | same |

- **The new cube does NOT change or break Care360** — `cs-ticket-reader.ts` is untouched; the Care tab keeps
  working exactly as today.
- **Both paths land at ~24%** — the new cube does NOT improve member coverage. The ceiling is structural:
  **Facebook Directly = 74.8% of cfm CS volume** (91,933 / ~122,857 tickets, 180d); FB filer PSID never maps to a
  game user_id (matches memory `cs-facebook-aihelp-uid-unresolvable`). jus is worse (9.5%) — even less ingame CS.
- **The new cube's real value is game-aggregate richness**, not member coverage: `cs_ticket_report` adds
  `resolution_time`, `time_to_first_response`, full sentiment lifecycle, CSAT (`ticket_rating`/`total_score`),
  `vip_id`, `dept`/`pillar`/`ticket_type`/`category` — none of which the reader exposes.
- **Coexistence (no divergence):** keep `cs-ticket-reader.ts` as the member-scoped Care reader (tested, in prod);
  use the new cube for per-game CS dashboards + segment dims. If member360 wires the new cube too, numbers agree
  (~24%) so they won't visibly conflict — but pick ONE source per surface to avoid two CS counts side by side.

## Acquisition (Phase 5) — channel→LTV + channel-grain CAC

Both games' `mf_users` were standardized to carry identical LTV+acquisition dims (`ltv_vnd`, `ltv_total_vnd`,
`payer_tier`, `media_source`, `is_paid_install`, `install_date/month`, + a `ltv_by_install_cohort` pre-agg).
`marketing_cost` (both games) carries spend + `cost_vnd/usd` + CPC/CPM by `media_source`/campaign. So:

| Game | channel→LTV | channel-grain CAC | Verdict |
|------|-------------|-------------------|---------|
| cfm | media_source **99.3%** non-null for payers | spend ÷ installs/payers by media_source | **GO — no new cube; compose in view** |
| jus | media_source **0%** for payers (51% overall) | spend exists, but cannot attribute payers to channel | **channel→LTV BLOCKED** |

- **jus channel→LTV is a hard structural blocker (Q10 / red-team #14 confirmed):** **0 rows** in jus `mf_users`
  have both `media_source` AND `recharge > 0` — the dual-identity merge keeps attribution and spend on disjoint
  identity rows. You can know a jus user's channel OR their spend, never both. jus can still expose channel-level
  marketing_cost (spend/CPC/CPM) + aggregate installs, but NOT payer/LTV-by-channel.
- **No new acquisition cube needed** — channel→LTV is pure composition over existing `mf_users` + `marketing_cost`
  (fold breakdowns into `user_360`/views, DRY). Bundle-level CAC stays deferred (dead `appsflyer.map_appsflyer_games`).

## "Anything more interesting" surfaced by the probe
- **jus is a mixed-currency game (USD + VND payers)** — cfm A49 is VND-only. Foreign-currency payers are a jus
  segment worth a dim.
- **Promo decomposition is real & rich** in billing (`promotion_type`, `promotion_charged_amount`,
  `promotion_trans_id`) → promo-aware ARPU, promo-driven-payer cohorts.
- **CS carries VIP tier (`vip_id`) + full sentiment lifecycle + CSAT** at game grain — VIP-routing / at-risk-VIP
  signals are available even though member-level CS coverage is low.
- **cfm CS is 75% Facebook** — a CS channel-shift insight in itself (most support happens off-game).

## Deferred / unresolved
- `etl_sdk_login` (285M events) — DEFERRED (no consumer; PII-heavy); not probed.
- jus `mf_users` attribution-merge non-NULL-for-payers (Q10) — verify in Phase 5.
- Refund = negative-amount rows? (Q4) — sample `payment_charged_amount < 0` in Phase 2.
- billing↔ingame reconciliation gap magnitude (Q6) — Phase 2 probe.
