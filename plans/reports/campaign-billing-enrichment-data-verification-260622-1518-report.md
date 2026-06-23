# Campaign-Billing Enrichment — Data Verification Report

Date: 2026-06-22 (GMT+7). Source probed live via `scripts/trino-query.mjs` against `iceberg.billing.*`.
Goal: assess `view_pmt_billing_delivery_daily` (promotion_charged_amt>0) as a Cube enrichment source for campaign-effectiveness + items-per-campaign analytics.

## TL;DR
- **Don't build a new revenue cube.** `view_pmt_billing_delivery_daily` is the SAME transaction universe as `std_billing_delivery_trans_gds`, which is already the source of the existing `billing_detail` cube. Using both = double-count.
- **Campaign capability is mostly an *exposure + join* job, not a new ingest.** The existing billing source already carries `item_name/item_type/promotion_trans_id/promotion_type`. Add: campaign_id join + campaign-effectiveness measures.
- **Campaign id chain is real and ~100% reliable**: `promotion_trans_id → view_pmt_discount_trans.discount_transaction_id → campaign_id`.
- **cfm_vn has near-zero promotions** (only Dec-2025); dense for purchases. jus_vn light (~600 promo rows/mo). Campaign-rich games: KTO(658), Zingspeed(377), MU Angel War(946), OMG2(278).

## 1. Game coverage (confirmed, last 60d)
product_code IS the game key. Verified mappings via `game_name`:
- `A49` = Crossfire Legends-VN = **cfm_vn** — 453,676 rows / 78,591 users (purchases dense)
- `A70` = Justice-VN = **jus_vn** — 206,968 rows / 26,124 users
- Campaign-rich: `658` Kiếm Thế Origin, `377` Zingspeed Mobile, `946` MU Angel War, `278` OMG2
- (Largest overall: 661 Play Together, 697 Roblox, 384 PUBG Mobile — distribution titles)

## 2. Promotion volume (promotion_charged_amt > 0)
- cfm A49: **only Dec-2025** (1,748 rows / 85.6M VND); zero other months in 12mo.
- jus A70: ~622 rows / 7.4M VND per month.
- Campaign-rich (90d): KTO 1,991 rows / 200M; Zingspeed 1,072; OMG2 332; muaw 112.
- `promotion_type` taxonomy = only 2 values: `ESP_TARGETING`, `ESP_TARGETING_VOUCHER`.

## 3. Campaign id chain (verified ~100% match, 90d)
`view_pmt_discount_trans` = (`discount_transaction_id`, `discount_id`, `campaign_id`).
Join `b.promotion_trans_id = d.discount_transaction_id`:
- KTO 1991/1991 matched, all campaign_id populated, **2 distinct campaigns**
- Zingspeed 1072/1072, 2 campaigns
- jus 622/622, 2 campaigns
- OMG2 332/332, 3 campaigns
- muaw 110/112 (98%), 3 campaigns
Note: campaign COUNT is small (2–3/game/quarter) — these are big targeted-voucher campaigns, not many SKU promos.

## 4. Identity join (mf_users) — near perfect
A49 May: 66,738 billing users → 66,736 matched to `game_integration.cfm_vn.mf_users` on `user_id` (99.997%).
Same direct-snowflake pattern as `billing_detail`. No vopenid bridge needed for this view.

## 5. Source reconciliation (decisive)
A49 May 2026:
- view_pmt_billing_delivery_daily: 221,686 rows / 173,324 orders / 50,586 users / 51.31B gross_charged
- std_billing_delivery_trans_gds: 221,801 rows / 173,420 orders / 50,598 users / 51.35B payment_charged
→ within 0.07% (tz-boundary). **Same universe — additive use double-counts.**

`quantity` in the view is **always 1** for cfm (distinct_qty=1, total_units=row count) → no extra "units" signal there.

### Schema delta: view vs std (both transaction/item grain)
- view-only: `quantity`(=1 cfm), `gross_vnd`(pre-normalized VND), named payment dims (`method_name/provider_name/partner_name/payment_gateway_name`), `game_name/dept/publishing_type/game_market`, `currency_rate/usd_vnd`, `delivery_status`, `login_type/method`.
- std-only: `order_created_timestamp`(bigint), `lps_trans_id`, `wallet_charged_amount/wallet_delivered_amount`, `ver`.
- Both: `order_number`, `user_id`, `item_id/item_name/item_type/item_price`, `promotion_trans_id`, `promotion_type`, `promotion_charged_amount`, `product_delivered_amount`.
- Amount naming differs: view `gross_charged_amt/promotion_charged_amt/product_delivered_amt` vs std `payment_charged_amount/promotion_charged_amount/product_delivered_amount`.

## Recommended design (revised from verification)
1. **Keep `billing_detail` (std source) as revenue source-of-truth.** Don't add a parallel revenue cube on the view.
2. **Expose item + promotion dims** already present in billing_detail: `item_name`, `item_type`, `promotion_type`, `is_promo` (derived promotion_charged_amount>0), `promotion_trans_id`.
3. **Add a thin `campaign_dim` cube** on `view_pmt_discount_trans` (discount_transaction_id, discount_id, campaign_id), joined `promotion_trans_id = discount_transaction_id`. Gives campaign-grain grouping.
4. **Campaign-effectiveness measures** (on billing_detail, promo subset): `subsidy_cost`(Σpromotion_charged), `cash_driven`(Σpayment_charged), `delivered_value`, `redemptions`(distinct order_number), `redeeming_users`(distinct user_id), ratios `subsidy_rate`, `arppu_redeemers`.
5. **Onboard billing_detail for a campaign-rich game** (recommend KTO 658 — highest volume) so the campaign surface has real data; jus_vn works but thin; cfm_vn gets item analytics only.
6. **Optionally** swap/enrich dimension *labels* from the view (named payment methods) — but re-validate existing rollups if changing source. Lower priority.
7. **Expose** via a view panel (extend user_360 or new campaign_360) + chat starter questions.

## ADDENDUM (probed 16:01) — promo presence + campaign metadata

### cfm/jus promo rows in std_billing_delivery_trans_gds (NOT zero — corrected)
14-month direct check on the EXISTING billing source:
- cfm A49: **Dec-2025 ONLY** — 869 rows / 42.6M VND / 869 users. Zero all other months.
- jus A70: 2026-05 = 541 rows / 6.48M; 2026-06 = 81 rows / 0.95M. Ongoing-light.
→ "cfm near-zero" was a demo-volume judgment; literal count = 869, not 0. One real Dec-2025 cfm campaign exists.
- Note: view reports MORE promo rows than std at promo grain (cfm Dec: view 1748 vs std 869; jus May: view 622 vs std 541) even though gross ties out. The two diverge at promo-row grain — reconcile before picking which carries promo measures.

### Campaign metadata chain — FOUND, but no name/date
Full chain resolves ~100%:
`std.promotion_trans_id → view_pmt_discount_trans.discount_transaction_id → (discount_id, campaign_id) → pmt_config_discount.discount_id → attrs`
- `iceberg.billing.pmt_config_discount` cols: discount_id, campaign_id, award_value(decimal, e.g. 0.50=50% off), max_award_value, currency, client_id, payment_gateway_id/partner_id/method_id/provider_id, sync_time.
- jus May verified: campaign `e6a4ab07…` = award 0.50, VND, client_id 101070, 620 rows, 7.4M subsidy, 529 users.
- **No human-readable campaign name, no start/end dates** in any iceberg.billing table. campaign_id + discount_id are UUIDs. Campaign can only be *characterized* by attrs (discount %, currency, payment targeting, game), not named. A friendly name needs an upstream ESP/promotion-mgmt source — NOT located in iceberg.billing.
- Other related tables seen: `etl_billing_ff_promotion_action_log`, `etl_billing_ff_esp_payment_vn_trans_log_prd`, `etl_esp_payment_vn_trans_log_prd`, `pmt_discount_trans` (base of view_pmt_discount_trans).

### Revised campaign-dim design
`campaign_dim` cube = `view_pmt_discount_trans` LEFT JOIN `pmt_config_discount` on discount_id.
Dims: campaign_id, discount_id, award_value (discount %), discount_currency, client_id, targeted payment_method/gateway/provider. Join to billing via promotion_trans_id = discount_transaction_id.
Label campaigns by "{award_value}% off · {currency} · {top item/method}" until a name source is found.

## Unresolved questions
- Are there >2–3 campaigns historically (12mo) or is low campaign-count structural? (probed 90d only)
- For campaign-rich games (KTO/Zingspeed): is `quantity` >1 there (units-sold meaningful) vs cfm's always-1?
- Does `view_pmt_discount_trans` carry a campaign NAME/label anywhere, or only opaque campaign_id? (need a campaign-name lookup for human-readable surfaces)
- `discount_id` vs `campaign_id` cardinality/semantics — which is the right grain for "a campaign"?
- Refund/negative rows handling in either source (not yet checked).
