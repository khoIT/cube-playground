# Iceberg Monetization Schema Map

## Executive Summary

The `iceberg` catalog contains **3 tiers** of monetization data:

1. **LIVE DAILY TRANSACTION LAYER**: `billing.std_billing_delivery_trans_gds` (58.6M rows, updated hourly) — grain: transaction; spans all products; identity key: user_id + product_code.
2. **LIFETIME PAYMENT HISTORY LAYER**: `billing.pmt_users_history` (18.5M rows, updated 2026-06-12) — grain: user × product_code; cumulative revenue + payer flags.
3. **CROSS-BRAND VGA REWARD LAYER**: `reward.latest_tier_profile` (34.5M rows, updated hourly) — VNG brand loyalty tiers, keyed by VGA client_id/profile_id (not game-scoped).

**REFUNDS/CHARGEBACKS**: None found in iceberg. Billing treats all delivery_status='success' as final revenue.

---

## Schema Inventory

### `iceberg.billing` (38 tables)
**Core monetization engine.** Contains ETL logs, aggregates, and production-ready marts.

| Table | Grain | Status | Freshness | Game-Scope | Identity Key | Notes |
|-------|-------|--------|-----------|-----------|--------------|-------|
| **std_billing_delivery_trans_gds** | transaction | LIVE | 2026-06-13 18:16 UTC | product_code | user_id, delivery_trans_id | Transaction-level with item detail, payment method, promo, and currency breakdown. 58.6M rows. |
| **pmt_users_history** | user × product_code | LIVE | 2026-06-12 18:39 UTC | product_code | user_id | Cumulative payer stats (first/last order, total amt VND/USD, count). 18.5M rows. |
| **pmt_users_monthly** | user × product_code × log_month | LIVE | 2026-06-12 18:37 UTC | product_code | user_id | Monthly cohort of pmt_users_history; includes paid_days. 51.1M rows. |
| pmt_delivery_transformed_v2 | transaction | STALE | 2026-01-01 16:59 UTC | product_code, game_name | user_id, delivery_trans_id | Pre-agg cache; replaced by std_billing_delivery_trans_gds. 220K rows. Do not use. |
| pmt_delivery_transformed | transaction | STALE | — | product_code | user_id | Superseded by v2. Skip. |
| pmt_users_daily | — | NOT FOUND | — | — | — | Not in iceberg.billing (may be in stag_iceberg; verify). |
| pmt_fa_monthly | — | NOT CHECKED | — | — | — | Finance/IFRS alignment table. |
| view_pmt_billing_delivery_daily_v2 | — | VIEW | — | — | — | Likely queries pmt_delivery_transformed_v2 (stale source). |
| std_pmt_user_history | — | EMPTY | — | product_code | user_id | Schema exists; 0 rows as of 2026-06-12. |

**Skip (raw/debug):**
- `etl_billing_*` (35 tables): raw firefly logs, callback logs, FFv3 flow logs. Only for audit trail, not for model sourcing.
- `pmt_billing_callback`, `pmt_discount_trans`: transient payment gateway debug tables.
- `pmt_config_discount`, `pmt_publishing_details`: static metadata, not a source for per-game model.

---

### `iceberg.payment` (15 tables)
**Monthly revenue aggregates.** High-level reporting, not transaction-level.

| Table | Grain | Status | Freshness | Game-Scope | Notes |
|-------|-------|--------|-----------|-----------|-------|
| **monthly_revenue_report_typed_v10** | monthly aggregate | LIVE | 2026-06-10 20:00 UTC | platform_id, app_id | 32K rows. Gross/PP value only; no user detail. |
| latest_payment_v2 | product metadata | EMPTY | — | product_code | Product config (genre, market, publishing_type). Not a transaction source. |
| latest_payment | product metadata | EMPTY | — | product_code | Same. |
| monthly_revenue_report* (v2–v9) | monthly | STALE | < 2026-06-10 | — | Versioned historical archive. v10 is current. |

**Skip:**
- All other tables are versioned snapshots or test tables. Use `monthly_revenue_report_typed_v10` for cross-game monthly revenue reconciliation only.

---

### `iceberg.payment_raw` (10 tables)
**Raw payment gateway logs.** Not recommended for live Cube sourcing; prefer `billing.std_billing_delivery_trans_gds`.

| Table | Notes |
|-------|-------|
| etl_billing_ff_delivery_trans_log | Firefly payment delivery log (raw). 50M+ rows. No product_code/game_id. Deprecated in favor of pmt_delivery_transformed_v2 or std_billing_delivery_trans_gds. |
| etl_sea_gateway_trans_log | SEA payment provider log. Unfiltered; requires provider_id → product_code bridge. |
| etl_billing_ff_esp_payment_vn_trans_log_prd | ESP (Esport) payment provider. Niche. |

**Verdict:** Payment_raw is too raw for per-game model. Use `billing.std_billing_delivery_trans_gds` instead.

---

### `iceberg.payment_gateway` (3 tables)
**Payment service provider metadata & aggregates.**

| Table | Grain | Status | Freshness | Notes |
|-------|-------|--------|-----------|-------|
| latest_dm_payment_report | — | EMPTY | — | Intended for daily payment aggregates; not populated. |
| latest_config_product | — | EMPTY | — | Product config; same as payment.latest_payment_v2 (empty). |
| latest_payment | product metadata | EMPTY | — | Duplicate of payment schema. |

**Verdict:** payment_gateway is not live. Skip.

---

### `iceberg.promotion` (40 tables)
**Campaign & gift/mission logs.** Relevant for promo-influenced revenue, not primary monetization.

| Table | Grain | Freshness | Game-Scope | Notes |
|-------|-------|-----------|-----------|-------|
| **promotion_campaign_summary** | campaign × game × date | 2026-07-01 | game_id, game_name | Promo impact KPIs (qualified, rewarded, redeemed, retention). 640 rows. Useful for promo-driven cohort analysis. |
| etl_gift_package_log_* | gift award | recent | game_id (embedded in log) | Per-game gift issuance; 20 sharded tables. ~100K rows each. |
| etl_mission_log | mission reward | recent | game_id | Per-game mission completion & reward. |
| etl_profile_info, etl_profilepoint | loyalty points | recent | game_id | Per-game player points ledger. Not money; skip unless modeling promo-to-paid funnel. |
| gs2_* (10 tables) | game-scoped mirrors | recent | game_id | Replication of etl_* tables. Prefer etl_ (source). |
| view_promotion_campaign* | — | VIEW | — | Summary views. Use actual tables, not views. |

**Verdict:** Promotion is for **promo impact analysis & cohort tagging**, not primary revenue. Can JOIN to billing via promo_trans_id if analyzing promo-driven LTV.

---

### `iceberg.reward` (35 tables)
**VGA brand loyalty (cross-game) + redemption logs.**

| Table | Grain | Freshness | Scope | Notes |
|-------|-------|-----------|-------|-------|
| **latest_tier_profile** | vga_user × tier | 2026-06-13 18:24 UTC | client_id (VGA brand, not per-game) | VNG tier membership (Silver/Gold/Platinum). 34.5M rows. **Key insight**: client_id ≠ game_id; it's a VGA namespace. Requires vga_user_id → game_user_id bridge. |
| **latest_redeem_code_transaction_v4** | transaction | 2026-06-13 18:29 UTC | game_code, game_name | Promo code redemptions (not IAP). 212M rows. Tracked per game. Used to measure promo & gift-box uptake. |
| latest_tier_transaction | tier point accrual | recent | client_id | VGA points ledger. Not money. |
| latest_tier_point_transaction | — | — | client_id | Alias for tier_transaction. |
| latest_transaction_reward_v2 | — | recent | game_code | Cross-game reward payouts. 30M+ rows. Grain unclear; schema inspection needed. |
| daily_redeem_code | code activation summary | recent | game_code | Daily promo code metrics. Aggregated from latest_redeem_code_transaction. |
| club_tier_snapshot_daily | vga tier daily snapshot | recent | — | Historical tier state for cohort tagging. Useful for churn/LTV by tier. |
| cons_daily_* metrics | retention cohort metrics | recent | — | Pre-computed retention by game/cohort. Skip (use raw transactions). |
| latest_gift_item, latest_gift_vendor, latest_product | metadata | recent | — | Config tables. Skip for live model. |

**Verdict:** Reward has **two separate systems**:
- **VGA tier** (cross-game loyalty): latest_tier_profile — bridges to game via club_tier_snapshot_daily.
- **Game-scoped redemption**: latest_redeem_code_transaction_v4 — tracks promo/gift redemptions per game. Not revenue; useful for promo funnel.

Neither is primary payment revenue. Reward is auxiliary (promo context, tier context, retention prediction).

---

### `iceberg.webshop` (9 tables)
**Webshop/storefront visits & purchases (separate from in-game IAP).**

| Table | Grain | Freshness | Notes |
|-------|-------|-----------|-------|
| **std_master_users** | user × shop | 2026-06-12 22:22 UTC | First/last visit, first/last paid, session counts, paid_users flag. 13.2M rows. **Not game-scoped**; shop_id is external storefront ID. |
| std_webshop_report_daily | shop × date | recent | Daily shop KPIs (visitors, paid_users, orders). Aggregated; not for per-game model. |
| ws_events_history | event | recent | Webshop event stream. May contain game_id; schema not inspected. |
| std_agg_users_monthly, std_agg_clients_monthly | monthly aggregate | — | — |
| std_master_clients | — | — | — |

**Verdict:** Webshop is a **separate commerce channel** (not in-game IAP). Useful for cross-channel LTV (webshop spend + IAP), but not game-scoped directly. Requires game_id external join or ignore for per-game model.

---

### `iceberg.ifrs` (4 tables)
**IFRS revenue recognition aligned transactions.**

| Table | Grain | Freshness | Game-Scope | Notes |
|-------|-------|-----------|-----------|-------|
| **ifrs_transaction_details** | transaction | EMPTY | game_id | Expected to match std_billing_delivery_trans_gds but scoped by game_id. **Currently 0 rows as of 2026-06-12.** Likely under construction or backfill stalled. DO NOT USE until populated. |
| ifrs_transactions_detail | — | — | game_id | Likely duplicate/previous version. Skip. |
| ifrs_publishing_details | — | — | — | Publishing entity (IFRS entity) metadata. Static. |
| std_recharge | — | — | — | Possibly linked to recharge_transaction_id for reversal tracking; not inspected. |

**Verdict:** IFRS schema was intended to be **game-scoped transaction truth table** but is not yet populated. Defer until backfill complete.

---

## Relevant Monetization Tables (Detail)

### Tier 1: Live Transaction Layer

**`iceberg.billing.std_billing_delivery_trans_gds`**
- **Grain**: One row per successful delivery (item shipped after payment).
- **Rows**: 58.6M (as of 2026-06-13 18:16 UTC).
- **Freshness**: Updated hourly.
- **Identity**: user_id, delivery_trans_id (unique); product_code links to game product.
- **Game-Scope**: product_code (required for per-game filtering).
- **Key Columns**:
  - `user_id`: GDS user identifier.
  - `product_code`: numeric product ID (e.g., 452, 454); maps to game_id via product metadata.
  - `server_id`, `role_id`: in-game character scope.
  - `order_number`, `order_created_datetime`: transaction identifier & timestamp.
  - `delivery_trans_id`: delivery event ID (duplicate payment detection).
  - `item_id`, `item_name`, `item_price`, `item_currency`: in-game item detail.
  - `payment_charged_amount`, `lps_charged_amount`, `promotion_charged_amount`, `wallet_charged_amount`: revenue decomposition (payment method mix).
  - `item_type`: virtual goods type (e.g., 'gem', 'pass').
  - `promotion_type`, `promotion_trans_id`: if promo-influenced.
  - `payment_gateway`, `payment_method_id`, `payment_partner_id`, `payment_provider_id`: provider context.
  - `delivery_datetime`: fulfillment timestamp (always ≤ order_created_datetime).
  - `country_code`: user geo.
  - `delivery_status`: always 'success' in this table (failures filtered upstream).
- **Bridge Required**: product_code → game_id (assumed available in product master).
- **Recommendation**: **PRIMARY SOURCE for per-game Cube model.** Use this table directly as fact; JOIN to game product metadata on product_code.

---

### Tier 2: Lifetime Payer History

**`iceberg.billing.pmt_users_history`**
- **Grain**: One row per (user_id, product_code) pair across all time.
- **Rows**: 18.5M (as of 2026-06-12 18:39 UTC).
- **Freshness**: Updated daily (last update 2026-06-12).
- **Identity**: user_id + product_code.
- **Game-Scope**: product_code.
- **Key Columns**:
  - `user_id`, `product_code`: primary key.
  - `first_time`, `first_date`, `first_month`: payer cohort (first purchase date).
  - `first_amt`: first transaction amount (double).
  - `order_number_first`, `order_number_last`: order ID bookends.
  - `last_time`, `last_date`, `last_month`: most recent transaction.
  - `total_trans`: count of purchases.
  - `total_amt_vnd`, `total_amt_usd`: lifetime revenue in each currency.
  - `updated_time`: last table refresh (≠ user's last transaction; lag ~1 day).
- **Use Case**: User-level LTV, payer cohort segmentation, churn flagging.
- **Recommendation**: **SECONDARY SOURCE for LTV dimension.** Use to pre-compute lifetime metrics; JOIN to std_billing_delivery_trans_gds for fact-grain analytics.

---

### Tier 3: Monthly Payer Cohort

**`iceberg.billing.pmt_users_monthly`**
- **Grain**: One row per (user_id, product_code, log_month).
- **Rows**: 51.1M (as of 2026-06-12 18:37 UTC).
- **Freshness**: Updated daily.
- **Identity**: user_id + product_code + log_month.
- **Game-Scope**: product_code.
- **Key Columns**:
  - `log_month`: YYYY-MM string (partition key).
  - `paid_days`: number of days in the month user paid (useful for detecting whales = high paid_days).
  - All other columns: same as pmt_users_history (first/last, total_trans, total_amt).
- **Grain Note**: This is NOT a daily payer grain; it's a monthly rollup of lifetime stats per user per month. Row per month even if user never paid that month (NULL total_amt).
- **Use Case**: Monthly cohort analysis, MoM retention, repeat purchase pattern.
- **Recommendation**: **OPTIONAL DENORM.** If building monthly-grain cubes, use this directly. Otherwise use pmt_users_history + log_date dimension.

---

## Verdict on 3 Key Questions

### (a) Live Daily Payer Table?
**YES: `iceberg.billing.std_billing_delivery_trans_gds`** (transaction-grain, hourly refresh, 58.6M rows).
- Does NOT aggregate to (user, date) level; each row = one payment event.
- To build daily-payer cube (1 row per user per day), aggregate this table on `CAST(order_created_datetime AS DATE)`.
- Alternative: Use pmt_users_monthly which pre-aggregates monthly, then query for a specific log_month.

### (b) Lifetime Payment History?
**YES: `iceberg.billing.pmt_users_history`** (user × product lifetime stats, 18.5M rows, updated 2026-06-12).
- Cumulative first/last/total; ready to use as dimension.
- Joined to std_billing_delivery_trans_gds on (user_id, product_code).

### (c) Refund / Chargeback Source?
**NO refund table found in iceberg.** 
- Confirmed: queried all 8 schemas for `*refund*`, `*chargeback*`, `*reversal*`, `*negative*` patterns → no matches.
- Billing logic treats delivery_status='success' as final revenue; no explicit reversal tracking visible.
- **Implication**: All revenue in std_billing_delivery_trans_gds is treated as settled. If chargebacks/refunds exist, they may be:
  1. Tracked in external payment provider systems (not in iceberg).
  2. Handled as negative transactions (rows with negative amount) in std_billing_delivery_trans_gds itself → inspect a sample to verify.
  3. Absorbed in monthly reconciliation tables (payment.monthly_revenue_report_typed_v10) but not exposed row-level.

---

## Schema-by-Schema Skip/Include Summary

| Schema | Include? | Reasoning |
|--------|----------|-----------|
| **billing** | YES | Core revenue. std_billing_delivery_trans_gds + pmt_users_history. |
| **payment** | NO | Aggregates only; use billing for transaction grain. monthly_revenue_report_typed_v10 for monthly reconciliation. |
| **payment_raw** | NO | Raw logs; prefer std_billing_delivery_trans_gds (transformed). |
| **payment_gateway** | NO | All tables empty or duplicates. |
| **promotion** | OPTIONAL | Promo context (promotion_campaign_summary) for impact analysis; not primary revenue. |
| **reward** | OPTIONAL | VGA tier + promo redemption; auxiliary to revenue, useful for retention/tier segmentation. |
| **webshop** | NO | Separate commerce channel; not in-game IAP; unclear game_id mapping. |
| **ifrs** | NO | Under construction (0 rows). Revisit when backfill complete. |

---

## Cross-Game Model Architecture Implication

For a **per-game Cube model** using iceberg:

1. **Fact Table**: `std_billing_delivery_trans_gds` filtered on product_code = game's product_id.
2. **Dimension: User LTV**: `pmt_users_history` filtered on same product_code.
3. **Dimension: Tier Context**: `reward.latest_tier_profile` joined via user_id (cross-game VGA tier).
4. **Dimension: Promo Context**: `promotion.promotion_campaign_summary` joined on (game_id, date range).
5. **Fact Grain**: (order_number, delivery_trans_id) — one row per payment event, indexed by order_created_datetime.
6. **Bridge Required**: product_code → game_id (should exist in a game product master; confirm location).

---

## Open Questions

1. **product_code → game_id bridge location**: Where is the authoritative game product metadata that maps product_code (e.g., 452) to canonical game_id (e.g., 'jxm')? Is this in `payment_gateway.latest_config_product` (currently empty) or elsewhere?

2. **Refund handling verification**: Are chargebacks/refunds represented as negative-amount rows in std_billing_delivery_trans_gds, or are they omitted entirely? Recommend sampling a few rows with filter `WHERE payment_charged_amount < 0` to confirm.

3. **IFRS backfill timeline**: When will `iceberg.ifrs.ifrs_transaction_details` be populated? Is it intended as the canonical game-scoped transaction table, or is std_billing_delivery_trans_gds the permanent truth table?

4. **VGA tier bridging**: Does a mapping exist from VGA client_id (in reward.latest_tier_profile) to game_id? If not, how should per-game models ingest cross-game VGA tier for churn prediction?

5. **Webshop game_id**: Does `ws_events_history` or `std_master_users` carry game_id/product_code for linking webshop revenue to in-game IAP, or are they wholly separate channels?

6. **std_pmt_user_history why empty**: `iceberg.billing.std_pmt_user_history` has schema but 0 rows. Is this deprecated in favor of pmt_users_history, or is it a planned future table?

---

