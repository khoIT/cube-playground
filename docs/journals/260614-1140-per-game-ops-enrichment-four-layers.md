# Per-game ops enrichment — four cross-cutting layers (cfm + jus)

**Date:** 2026-06-14 · **Plan:** `plans/260614-0040-per-game-ops-enrichment-four-layers`
**Branch:** `feat/per-game-ops-enrichment-cubes` (cube-dev + main)

## What shipped
Four iceberg-sourced, game-scoped Cube layers for cfm + jus, wired into `user_360` views and member360:
- `billing_detail` — payment gateway/method/store/item/promo breakdown (txn→user×day×breakdown; gross; currency-aware) + day×breakdown rollup/lambda pre-agg.
- `billing_lifetime` — canonical-billing LTV cross-check (`pmt_users_history`).
- `user_identity` — geo/lifecycle/login-channel (`vga.std_all_game_user_profile`), tagged `[freshness: lagging]`.
- `cs_ticket_detail` — resolution/CSAT/sentiment/VIP from `cs_ticket_report`; member id exposed as `user_id`, gated on real mf_users membership.
- Tokenless `GET /api/segments/:id/members` now redacts monetization/CS/VIP columns for unauthenticated callers (uid + pre-existing ltv rank-measure preserved). Unit-tested.

## Phase-1 GO/NO-GO gate paid off — empirics overturned plan assumptions
- **cfm billing = A49 only.** `267`/cfmobile is dead (0 billing rows/yr, last activity 2020) — would drop match 99.99%→78%.
- **jus billing is mixed USD+VND** (cfm A49 VND-only) → currency-aware measures + currency in the rollup.
- **CS product_id = 856 (cfm) / 832 (jus), not the plan's assumed 267.** Discovered by joining customers_v2→mf_users and grouping by product_id (267→0 matches, 856→235k).
- **Identity LIVE source unavailable:** `gds_da.etl_user_profile` has only bum+thiennu3 → consolidated two planned identity cubes into one, sourced from `vga` (lagging ~1 month).
- **jus channel→LTV structurally blocked:** 0 rows in jus mf_users carry both attribution and spend (dual-identity merge keeps them on disjoint rows). cfm works (media_source 99.3% for payers) → no new acquisition cube; view composition only.

## CS reality check (answered a direct question)
New CS cube does NOT change/break the existing Care360 reader. Measured both join paths apples-to-apples: existing reader 24.3% vs new cube 23.3% member resolution — identical ceiling, because ~75% of cfm CS is Facebook tickets whose PSID never maps to a game uid. The new cube's value is game-aggregate richness (CSAT/sentiment/resolution/VIP), not member coverage.

## Bugs caught during verification
1. Cube named `user_profile` collided with the existing `user_360` **view** name → broke the *whole* game model compile. Renamed to `user_identity`. (The "one bad YAML breaks the model" hazard, live.)
2. CS `member_resolved` falsely read 100% — `member_user_id` came from `customers_v2.user_id` (~100% present) without checking mf_users membership. Gated it → honest 45% (recent window).

## Verification
All 4 cubes compile + execute via Cube `/meta`+`/load` on both games; reconciliation probe ran (gateway ≈ 1.78× ingame, Apple-pricing-driven, canonical stays ingame); server+FE typecheck clean; tests green (parity 14, members-pull 11, member360 routes 4, cs-tickets 10, redaction 3); code-review verdict safe-to-commit (two flagged items confirmed resolved by probe: customers_v2 no fan-out, 856/832 correct).

## Deferred (honest)
Dashboard cards, `segment-metric-registry` live monetization row, pre-agg CubeStore build verification (dormant locally), full playwright/ground-truth suite.

## Post-review refinement (2026-06-14)
Independent duplication review against `mf_users` showed two of the four cubes were largely redundant for cfm/jus:
- **`user_identity` TRIMMED** to the 4 net-new-vs-mf_users cols (`register_date`, `last_os`, `install_app_store`, `user_type`) + `user_id`. mf_users is the LIVE identity backbone and already carries geo (first/last_login_country), channels, media_source, LTV, lifecycle — fresher. The lagging vga source re-exposing them was duplicative noise; PII dropped.
- **`billing_lifetime` RESCOPED** to reconciliation-only: kept gateway-charged `lifetime_vnd`/`usd`/`txn` + aggregates (relabeled "reconcile vs mf_users"); dropped cohort dates / `product_code` / `first_amt` (all duplicated mf_users). It is NOT a new LTV dimension source — mf_users owns LTV; this cube only quantifies the gateway-vs-ingame gap.
- **`billing_detail` and `cs_ticket_detail` kept full** — the genuine net-new (payment/promo breakdown; first CS cube at game-aggregate).
- Views (`user_360`) + FE member360 panels updated in lockstep. Ops panels moved to their own `section: 'ops'` (they are user_id-keyed snapshots, not dteventtime event streams) — fixes the member360 guardrail test that assumed every behavior panel is an ETL event panel.
