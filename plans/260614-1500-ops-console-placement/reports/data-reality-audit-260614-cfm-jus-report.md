# Data-Reality Audit — /ops console (cfm + jus)

Empirically probed live Cube /load 2026-06-14 (cfm + jus, local). Goal: what data ACTUALLY exists →
which cards/charts are buildable now. Corrects several mockup/plan assumptions.

## Headline corrections (vs mockup/plan)

1. **NO double-count / fan-out.** For the SAME 13 days (Jun 1–13): raw store-grouped == rollup
   gateway-grouped == **₫15.370B exactly**. The earlier "₫44B store query = 3× inflation" was wrong —
   ₫43.96B is simply the full 30d (raw covers it; the rollup only has the June partition sealed).
   → **Phase 2's "add store/method to fix double-count" premise is FALSE.** Bounded (≤31d) raw queries on
   store/method are CORRECT. Real rollup issue = **history gap** (only June sealed), not fan-out.

2. **`recharge.revenue_vnd` is INFLATED ingame-currency units, NOT VND.** cfm 30d revenue_vnd = ₫399.8B
   but revenue_vnd_real = ₫43.6B, and billing_detail cash = ₫43.96B. → revenue_vnd_real ≈ billing cash
   (~0.8% gap, they reconcile). **NEVER use `recharge.revenue_vnd`** for money; use `revenue_vnd_real` or
   `billing_detail.cash_charged_gross`.

3. **Near-term gateway-vs-ingame gap ≈ 0**, not "+12% widening". The real reconciliation gap is at
   **lifetime**: `billing_lifetime` ₫508.2B vs `mf_users` LTV ₫358.0B = **+42%** gateway-gross over
   ingame-attributed LTV. Reframe the reconciliation card to lifetime (the meaningful gap).

4. **Promo-aware ARPU card NOT buildable.** cfm `promo_charged_gross` = **0** (promotion_type only null);
   jus = ₫952k (0.007%, negligible). The mockup's "18% promo share" is fabricated. → DROP the card (or
   permanent empty-state).

5. **Store card & item_type card = redundant — DROP.** store is 1:1 with gateway (shop.vnggames=VNG,
   Apple=Apple, Google=Google); item_type has a single value "PACKAGE".

6. **geo_moved comes from `mf_users`, not `user_identity`.** `user_identity` is thin (only `users` +
   register_date/os/store/user_type — no geo). `mf_users` has `geo_moved` + first/last_login_country.

## What's REAL and buildable now

| Element | Source | cfm (30d / snapshot) | jus | Verdict |
|---|---|---|---|---|
| Cash revenue | `billing_detail.cash_charged_gross` (= `recharge.revenue_vnd_real`) | ₫43.96B | ₫14.24B | ✓ real |
| Transactions | `billing_detail.txn_count_total` | 166,732 | 41,653 | ✓ real |
| Paying users | `billing_detail.paying_users` | 50,400 | 15,395 | ✓ real |
| Cash daily trend | billing_detail by day (raw, ≤31d) | ✓ Jun series real | ✓ | ✓ real |
| Payers-vs-cash trend | billing_detail by day | ✓ (Jun 5 spike real) | ✓ | ✓ real |
| Gateway mix | `billing_detail.payment_gateway` | VNG 67/Apple24/Goog9 | VNG **99.5%** | ✓ real (jus = 1 bar, low value) |
| Gateway-mix-over-time | billing_detail gateway×day | ✓ | ✓ (flat) | ✓ real |
| Support health | `cs_ticket_detail` (30d, ~2d lag) | 10,276 tix, CSAT **2.83**, neg 3,166, unresolved 5,621, res 17.3h | 2,987 tix, CSAT **4.65**, unresolved 2,722 | ✓ real (closed_tickets=0 → measure bug, investigate) |
| Lifetime reconciliation | `billing_lifetime` vs `mf_users.ltv_total_vnd` | ₫508.2B vs ₫358.0B (+42%) | — | ✓ real |
| Cross-border (geo_moved) | `mf_users.geo_moved` | 19,834 movers, ₫16.8B LTV (avg 845k vs 47.6k base = **18×**) | 4,553 movers, ₫40.75B LTV (avg 8.95M vs 295k = **30×**) | ✓ real, STRONG card |
| Acquisition spend / CPC | `marketing_cost` (game_integration) | ₫2.88B, 189M imp, 1.66M clk, CPC ₫1,731 | ₫2.10B, 865k clk, CPC ₫2,433 | ✓ real |
| Blended ROAS | revenue_vnd_real ÷ spend | ~**15×** (not 3.7×) | ~6.8× | ✓ computable (blended); cohort ROAS needs paid-install join |

## What's NOT available / weak (do not fabricate)

- **Promo decomposition** — cfm 0, jus negligible. No promo-aware ARPU.
- **store / item_type breakdowns** — redundant / single-value.
- **`recharge.revenue_vnd`** — inflated units; banned for money.
- **`user_recharge_daily` 30d** — under-populated (cfm 30d = only ₫13.6B / 15.9k payers vs billing 43.96B/50.4k) → partial days; don't use for window totals. Use billing_detail or recharge.revenue_vnd_real.
- **billing_detail rollup history** — only June partition sealed; 30d trend that crosses into May must use raw (≤31d bound) or the rollup must be re-sealed for history.
- **Cohort/paid ROAS, CPI, CAC** — need `mf_users.is_paid_install` + install-date join to spend; blended ROAS is the honest now-metric.
- **user_identity cube** — too thin for an identity card; geo/lifecycle lives in mf_users.

## Revised card set for the Overview (real-data-only)

Hero: Cash · Transactions · Paying users (+Δ vs prior) · **Cross-border whale LTV** (replaces promo) ·
**Lifetime recon gap +42%** (replaces near-term gateway gap).
Trends: cash daily · payers-vs-cash · gateway-mix-over-time. (all real)
Panels: Gateway mix · Support health · **Lifetime reconciliation** (508B vs 358B) · **Cross-border
(geo_moved, mf_users)** · **Acquisition & spend** (spend/CPC/CPM real + blended ROAS, cohort flagged).
DROP: promo-aware ARPU, store card, item_type.

## Unresolved questions

1. `cs_ticket_detail.closed_tickets` = 0 for cfm (jus not checked) — measure/status mapping bug? Affects
   "open vs closed" framing on the support card.
2. Re-seal `billing_detail` rollup history (full 120d) vs rely on bounded raw for ≤31d windows? (perf vs
   build cost — pick in Phase 2.)
3. Cohort ROAS/CPI/CAC: build the paid-install join this round, or ship blended ROAS + spend only and
   defer cohort? (recommend defer cohort.)
4. jus near-zero IAP (VNG 99.5%) — keep the gateway-mix card for jus (1 bar) or collapse to a single stat?
