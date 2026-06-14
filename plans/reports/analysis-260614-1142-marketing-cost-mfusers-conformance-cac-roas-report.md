# marketing_cost ↔ mf_users conformance + CAC/ROAS prototype — cfm_vn

> Verifies whether the isolated `marketing_cost` mart can be analyzed against the `mf_users` hub via shared
> dimensions (no physical join), and prototypes the resulting CAC/ROAS surface. Live data, `game_integration`
> catalog, schema `cfm_vn`. Verified 2026-06-14. Read-only.

## Why this matters
`marketing_cost`, `game_key_metrics`, `new_user_retention`, `retention` show **isolated** in the data-model
graph: they have **no `user_id`** (grain = date × acquisition-slice), so they cannot be hub spokes. The
useful link is **dimension conformance** — `mf_users` already carries `campaign_id`, `media_source`,
`install_date`, `is_paid_install` — letting spend and per-user LTV be analyzed on a shared key without a
fan-out join. This report tests that the key VALUES actually align, then proves the CAC/ROAS numbers.

## 1. Conformance — keys align, no remap needed

Source columns (bare, identical names both sides): `mf_users` (base table `mf_users`) and
`std_marketing_cost_all_channels_by_game` each expose `campaign_id` + `media_source`.

| Key | distinct (mf_users) | distinct (cost) | overlap | user rows matched | null key |
|-----|--------------------:|----------------:|--------:|------------------:|---------:|
| `campaign_id` | 193 | 38 | **36 / 38** | 27.2% | 44.9% |
| `media_source` | 30 | 4 | **4 / 4** | 42.8% | 15.1% |

- **`campaign_id` = clean join key.** Same format both sides (Meta numeric IDs, e.g. `120233135172330027`).
  36/38 costed campaigns map to real users. No case/prefix transform required.
- **`media_source` conforms at network level.** Cost = the 4 paid networks (Apple Search Ads, Facebook Ads,
  Google Ads, Tiktok Ads), all 4 present in mf_users. mf_users carries 26 extra finer/organic labels
  (`CFL_Brand_*`, `Pre-reg`, `Branding social`) with no spend — expected, not a mismatch.
- **Coverage partial BY DESIGN:** 44.9% null `campaign_id` / 15.1% null `media_source` = organic/unattributed
  installs (no acquisition cost → correctly excluded from spend analysis). The 27.2% paid-attributed cohort
  is what joins.

## 2. CAC / ROAS prototype (last-90d spend vs 90d install cohort)

Method: aggregate each side independently, join on `campaign_id` (no row-level fan-out). LTV =
`ingame_total_recharge_value_vnd` (in-game recharge). CAC = spend ÷ acquired users. ROAS = cohort LTV ÷ spend.

**Portfolio (36 matched campaigns, 90d):**

| total cost | users acquired | early LTV | blended ROAS | blended CAC |
|-----------:|---------------:|----------:|-------------:|------------:|
| 8.62B VND | 426,642 | 1.81B VND | **0.21** | **20.2K VND/user** (~$0.80) |

**Top campaigns by spend (excerpt):**

| campaign | cost (M VND) | users | payers | LTV (M VND) | CAC (K VND) | ROAS | payer % |
|----------|-------------:|------:|-------:|------------:|------------:|-----:|--------:|
| `…980` GG\|AND | 3,988.8 | 304,859 | 1,198 | 601.7 | 13.1 | 0.15 | 0.4 |
| `…290` TT\|IOS | 582.5 | 9,434 | 94 | 38.9 | 61.7 | 0.07 | 1.0 |
| `…027` FB Awareness/Reach | 387.3 | 16,118 | 260 | 196.3 | 24.0 | **0.51** | 1.6 |
| `…242` FB\|iOS MAI | 219.6 | 10,012 | 229 | 128.5 | 21.9 | **0.59** | 2.3 |
| `…921` Awareness/Reach | 336.1 | **30** | 0 | 0 | **11,202** | 0 | 0.0 |
| `…088` Awareness/Video | 166.3 | **1** | 0 | 0 | **166,318** | 0 | 0.0 |

**Reads as sane + discriminating:**
- CAC ~20K VND (~$0.80) — plausible for a VN mobile FPS. Numbers behave.
- Discriminates channels: FB performance campaigns ROAS 0.51–0.59 vs Google-Android volume play 0.15. Exactly
  the marketing-efficiency unlock the conformance enables.
- **Surfaces a real finding:** brand/awareness/video campaigns (`…921`, `…088`) carry spend with ~0–30
  attributed installs → CAC explodes (11.2M, 166M VND). These are not install-optimized and must NOT be judged
  on install CAC. Quantifies conformance flag #1 (spend with near-zero attributed installs).

## 3. Verdict
Conformance is **viable in cfm_vn today, zero data fixes.** Campaign-level CAC/ROAS/LTV:CAC works now via two
cubes on a shared `campaign_id` — no cube join to wire (a hub join would fan out). Recommended surface: a
marketing-efficiency view/dashboard, restricted to the paid-attributed cohort, separating performance vs
brand/awareness campaigns.

## Caveats (productionization)
- **ROAS is early/D90** — 90d-install cohort has immature LTV; lifetime ROAS will be higher. Use a fixed cohort
  age (e.g. D30/D90/D180 ROAS) for trend tracking, not a rolling raw window.
- **Window alignment approximate** — spend `log_date` 90d vs install `install_date` 90d roughly align; a
  production view should align cohort-to-spend windows per acquisition date.
- **LTV = in-game recharge only** (`ingame_total_recharge_value_vnd`); excludes web revenue → ROAS slightly
  understated. Add `ltv_web_vnd` for full ROAS.
- 2 cost campaigns (38−36) have no matched users — exclude or flag as attribution gaps.

## Unresolved questions
1. Which ROAS horizon do stakeholders want as the headline (D30 / D90 / D180 / lifetime)? Drives cohort-age
   logic in a production view.
2. Should brand/awareness campaigns be split into a separate (non-CAC) reporting bucket, or filtered out by an
   `objective`/campaign-name rule? (`marketing_cost.objective` dim exists — could gate.)
3. Does conformance hold on the other 7 games? (Option b — not yet run.)
