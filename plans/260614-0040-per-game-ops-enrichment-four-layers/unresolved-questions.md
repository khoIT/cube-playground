# Unresolved Questions (build-gating)

Carried from the four iceberg schema-map reports + the red-team review. Each notes WHAT it gates so the build doesn't
silently proceed on a guess. Source flipped to `iceberg`; resolved stag_iceberg-era questions pruned. **Q5 was the
members-API PII decision — now RESOLVED (see "Resolved by user validation" below); its number is retired, not reused.**

| # | Question | Gates | Resolve in |
|---|----------|-------|------------|
| 1 | **product_code(s) → game coverage for cfm/jus.** Probed: cfm = `A49` (cfmvn) + `267` (cfmobile); jus = `A70` (jusvn). Are these the COMPLETE set per game, and does cfm truly span both A49+267 in billing? | Game-isolation of every monetization/identity cube — filtering on a partial set undercounts. | Phase 1 |
| 2 | **CS product_id namespace vs billing product_code.** `cs_ticket.customers_v2.product_id` uses `267` for cfm vs billing's `A49`. Confirm the full CS product_id set per game and that the `customer_id→product_id→game` reconciliation is correct. | CS cube game-scope. Wrong reconciliation scopes CS to the wrong game. | Phase 1 |
| 3 | **billing.user_id → mf_users match-rate per game** (after product_code filter + real_users_only). Sample shows user_id IS the GDS snowflake (direct join), but the matched % is unmeasured. | Monetization GO/NO-GO. <70% ⇒ BLOCKED, fall back to existing `user_recharge_daily`. | Phase 1/2 |
| 4 | **Refund/chargeback source — none in iceberg.** Confirmed no refund/reversal table across all 8 monetization schemas. Are refunds negative-amount rows in `std_billing_delivery_trans_gds`? | Net-revenue. Until resolved, monetization exposes GROSS only (`revenue_vnd_gross`); no "net" claim. Follow-up: sample `WHERE payment_charged_amount < 0`. | Phase 1/2 + follow-up |
| 6 | **billing↔ingame reconciliation gap MAGNITUDE.** The reconciliation probe compares billing `payment_charged_amount` (gateway cash) vs ingame `user_recharge_daily.revenue_vnd` (delivery) for a known user/day. The decision is settled (canonical stays ingame; gap is expected — different funnel points) but the gap SIZE is unmeasured until the probe runs. | Sanity-bounding the expected gap; a wildly large gap could signal a join/scope bug, not just funnel difference. | Phase 2 (probe output) |
| 7 | **segment-metric-registry vs STD_RECHARGE (RED-TEAM #12).** Does the existing STD_RECHARGE binding already cover daily recharge metric-movement, making a new billing row redundant? | Whether a new registry row is an extension or a duplicate. | Phase 7 |
| 8 | **`vga.std_all_game_user_profile` freshness tier.** Report classifies it "Batch daily ~24h" but it's a 400.6M broad table. Is it live-daily or lagging for cfm/jus specifically? | The freshness tag on `lifecycle_profile` (live vs lagging). Tag from max-date, not assumption. | Phase 1/3 |
| 9 | **CS 826 unmatched rows + outbound CS.** 0.01% customer_id unmatched (likely test/deleted) — quarantine or drop? And is proactive/outbound CS logged as a ticket? | CS `unresolved_share` semantics; outbound compliance edge. Cube valid for inbound triage regardless. | Phase 1/4 + ops confirm |
| 10 | **jus mf_users attribution-merge (RED-TEAM #14).** jus `max()`-merges dual identity rows (`jus/mf_users.yml:2-35`). Are the merged acquisition dims (media_source/campaign/is_paid_install) non-NULL for jus payers? | jus channel→LTV/CAC attribution. NULL merged dims ⇒ no channel attribution for jus. | Phase 1/5 |

## Resolved by user validation (2026-06-14)
- **Members-API PII policy (was RED-TEAM #11 / Q5):** RESOLVED — auth-gate `GET /api/segments/:id/members`
  (`server/src/routes/segments.ts:458-465`) BEFORE any monetization/CS/VIP dim enters a preset's `memberColumns`; keep
  `public:false` PII deny-list as defense in depth. Scoped into Phase 7 as a required sub-task. No longer an open decision.
- **Payment model / `user_recharge_daily` overlap (was RED-TEAM #9 / Q6):** RESOLVED — KEEP `user_recharge_daily` as the
  authoritative daily ingame revenue (no fold, no duplicate). ADD `billing_detail` (method/promo/cash breakdown) +
  `billing_lifetime` (LTV cross-check) as enrichment. The reconciliation probe still RUNS (its gap-magnitude is the new
  open Q6 above) but the model decision is settled — billing never overrides ingame.

## Resolved by the iceberg flip (no longer open)
- **CS match-rate (was ~8% split_part):** RESOLVED — `customer_id→customers_v2.product_id` = 99.9% (CS report). The old
  split_part/PSID-unresolvable framing no longer applies to the cube's primary path.
- **Monetization bridge key (was "numeric vs game-account, prefer vga_id"):** RESOLVED — `billing.user_id` IS the GDS
  snowflake, joins mf_users directly. No vga_id routing, no translation table.
- **npu/dpu semantics:** moot — the new billing payer cube derives paying-users/ARPPU from transaction rows directly;
  no opaque pre-computed npu/dpu column to caveat.
- **thinking_data / mf_ip2location / ingame_user_profile keys:** moot — those stag_iceberg-era tables are no longer
  sources; replaced by `gds_da.etl_user_profile` + `vga.std_all_game_user_profile` keyed on `(game_id, user_id)`.
- **bundle_code↔game_id for CAC:** still deferred (locked decision), BUT channel-grain CAC is now NOT blocked
  (`marketing_cost.yml` exists). Only bundle-level CAC awaits a `gds_bundle_code↔cost` bridge (follow-up).

Resolution rule: any table whose join key/game-scope cannot be reliably resolved in Phase 1 (match-rate <70% or
unprovable game-isolation) is flagged BLOCKED — its cube is dropped this round (documented), never faked.
