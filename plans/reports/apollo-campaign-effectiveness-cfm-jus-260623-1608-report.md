# Apollo Campaign Effectiveness — cfm_vn & jus_vn (pre-feature sketch)

Date: 2026-06-23 (GMT+7) · Source: `iceberg.pro_apollo` via `scripts/trino-query.mjs` · Scope: exploratory, no code committed
Prior map: `apollo-liveops-bucket-data-map-260623-1317-report.md`

## TL;DR

- **98 Apollo campaigns** total for our two games: **jus_vn (A70) = 84**, **cfm_vn (A49) = 14**.
- **But most aren't player-facing-measurable.** 60/84 jus campaigns are ad-platform *audience exports* (google/meta/tiktok, `sent=0`); ~30 more are QA/test IAM blasts. Genuinely live, measurable campaigns across both games: **~5**.
- **Only ONE campaign has end-to-end outcome data**: cfm's **"Vòng Quay Tân Niên Đột Phá"** (Lunar-New-Year lucky-wheel). It grossed **10.84B VND (~$427K)** over 10 days, 9,662 players, 299,859 spins — and its participants **join 100% to `cfm_vn.mf_users`**.
- **Temporary data model is proven joinable** (no production change needed to analyze): `dash_promotion_play.identifier_id` → `split_part(:,2)` = `mf_users.user_id`; `apollo_campaign_summary` keyed by `product_code` (A49/A70). Revenue lives in `dash_promotion_daily.gross_amt`.
- **Feature implication:** Apollo's value for the playground is **segment membership + promotion-outcome (revenue) joins**, not generic "campaign ROI" — outcome data only exists for promotion-engine campaigns (lucky-wheel/gift), not for push/IAM/ad-export. Scope the first feature to the promotion-outcome slice.

---

## 1. Temporary data model sketch (analysis-only, not committed)

No cube YAML / migration written. The join graph below is what the queries in this report use; it is the candidate shape for a future `liveops_*` cube pair.

```
apollo_campaign_summary            dash_promotion_daily              dash_promotion_play
(campaign × month)                 (promotion × day)                 (per spin/claim)
  product_code  A49/A70  ──┐         product_code  A49/A70             identifier_id "A49:{uid}:..:.."
  campaign_id              │         promotion_id  ───────┐             promotion_id  ─────┐
  channel,status,segment   │         gross_amt (VND)      │             gift_name, segment │
  sent/qual/play/paid      │         played_users,turns   │             play_at            │
                           │                              │                                │
                           └─ name match ─┐    promotion_id = campaign_id (lucky-wheel)     │
                                          ▼                                                 ▼
                                                       split_part(identifier_id,':',2) = user_id
                                                                          │
                                                                          ▼
                                          game_integration.{cfm_vn|jus_vn}.mf_users.user_id
                                          (+ downstream revenue / retention cubes)
```

**Proven join keys (this report):**
- `product_code`: A49 = cfm_vn, A70 = jus_vn (authority: `view_promotion_map_product_code`).
- `dash_promotion_play.identifier_id` pattern `= "{product_code}:{user_id}:{n}:{n}"`; `split_part(identifier_id,':',2)` = `mf_users.user_id`. **Verified 7,032/7,032 = 100% match** for the lucky-wheel.
- lucky-wheel `apollo_campaign_summary.campaign_id (2011288550702137344) == dash_promotion_daily.promotion_id` — campaign ↔ promotion are the same id for promotion-channel campaigns.

**Draft serving view** (what a temporary view would look like — NOT created):
```sql
-- candidate: vw_liveops_promotion_participant (per game, per promotion, per user)
SELECT p.product_code,
       p.promotion_id, p.promotion_name,
       split_part(p.identifier_id, ':', 2) AS user_id,
       p.segment, p.gift_name, p.play_at
FROM iceberg.pro_apollo.dash_promotion_play p
WHERE p.product_code IN ('A49','A70');
-- then LEFT JOIN game_integration.<game>.mf_users + revenue cube on user_id
```

---

## 2. Campaign census (how many ran)

`apollo_campaign_summary`, grouped by game/channel/status:

| Game | Channel | Status | Campaigns | Total sent | Player-facing? |
|------|---------|--------|-----------|-----------|----------------|
| **cfm_vn** | inapp-message | completed | 8 | 14 | test (≤10 ea) |
| | inapp-message | stopped | 1 | 0 | test |
| | tiktok | completed | 2 | 0 | **ad export** (churn) |
| | meta | completed | 2 | 0 | **ad export** (churn) |
| | **lucky-wheel** | completed | **1** | — | **YES — real** |
| **jus_vn** | google | completed | 28 | 0 | ad export |
| | meta | completed | 19 | 0 | ad export |
| | tiktok | completed | 13 | 0 | ad export |
| | inapp-message | completed/active/stopped | 17 | 21 | test |
| | notification-push | completed | 3 | 11 | test |
| | **sms** | completed | **2** | **299,725** | **YES — real** |
| | **email** | completed | **1** | **19,292** | **YES — real** |
| | email | scheduled | 1 | 0 | pending |

**Read:** cfm_vn is still in QA/onboarding (1 real campaign). jus_vn is heavily used for **ad-platform audience export** (60 campaigns feeding Meta/Google/TikTok Custom Audiences — the "Past Segment → external targeting" use case) plus a handful of real SMS/email reach campaigns. The push/IAM channels are almost entirely operator test traffic so far.

---

## 3. Top 3 most interesting (selection rationale)

Picked for **measurability × business signal × channel diversity**:

| # | Campaign | Game | Channel | Why interesting |
|---|----------|------|---------|-----------------|
| 1 | Vòng Quay Tân Niên Đột Phá | cfm_vn | lucky-wheel | Only campaign with full revenue+funnel; 10.8B VND; per-user joinable |
| 2 | OB SMS – 511 – Paying Users VNG | jus_vn | sms | Largest real reach (278K); explicit paying-user targeting; retention play |
| 3 | VNG MMO / CBG Churn Re-targeting | cfm_vn | meta + tiktok | Cross-channel winback; segment-defined; the canonical "liveops" pattern |

---

## 4. Deep dive #1 — cfm_vn "Vòng Quay Tân Niên Đột Phá" (Lunar New Year Lucky Wheel)

**What it is:** a Tết spin-the-wheel promotion (gifts: Gem 288 / Gem 188 / Xu May Mắn …), promotion-engine channel, `segment = "Segment 1"`. campaign_id/promotion_id `2011288550702137344`. Active **2026-01-21 → 2026-01-28** (+ Jan 16/20 tests).

**Funnel (built-in, `apollo_campaign_summary` + `dash_promotion_daily`):**

| Stage | Value |
|-------|-------|
| Qualified identifiers | 15,562 |
| Players (distinct) | 9,662 (7,032 in core Jan 21-28 window) |
| Total spins | 299,859 (~31 spins/player) |
| **Gross revenue** | **10,844,744,000 VND ≈ $427K** |
| Play rate (played/qualified) | **62%** |
| Rev / player | ≈ 1.12M VND (~$44) |

**Daily curve** (`dash_promotion_daily`):

| Date | Qual | Played | Spins | Gross (VND) |
|------|-----:|-------:|------:|------------:|
| 01-16 | 2 | 1 | 52 | 50,000 (test) |
| 01-20 | 10 | 6 | 1,201 | 0 (soft launch) |
| 01-21 | 2,124 | 1,449 | 30,580 | 1.08B |
| 01-22 | 1,806 | 982 | 33,745 | 1.20B |
| **01-23** | **2,747** | **1,546** | **67,632** | **2.51B** ← peak |
| 01-24 | 2,026 | 1,098 | 41,952 | 1.53B |
| 01-25 | 1,751 | 897 | 33,677 | 1.21B |
| 01-26 | 1,589 | 952 | 30,746 | 1.14B |
| 01-27 | 1,886 | 1,482 | 31,477 | 1.15B |
| 01-28 | 1,621 | 1,249 | 28,797 | 1.04B |

**Effectiveness verdict:** clear winner. 62% qualified→play conversion, sustained ~1B+ VND/day, Day-3 (Tết eve) revenue spike to 2.5B. **100% of players resolve to `mf_users`**, so the playground could attribute *post-campaign D7/D30 revenue & retention* to participants vs non-participants — a true incremental-lift study (not done here; needs the revenue cube join). This is the template campaign worth modeling first.

**Caveat:** `played` here = wheel participants, not necessarily net-new payers; gross_amt is wheel-spend, likely funded by prior recharge — so it measures *engagement-driven spend*, not incremental revenue. Lift study needs a pre/post or holdout baseline.

## 5. Deep dive #2 — jus_vn "NTH – OB SMS – 511 – Paying Users VNG"

**What it is:** SMS blast to VNG paying users, 2025-11-05, **278,234 sent** (+ a 21,491 "Retry Mobi" follow-up = 299,725 total SMS). segment_id `1984112625036202000` attached. Channel `sms`. Clearly a re-engagement / payment-reactivation push to a known-paying audience around a milestone (server/launch "511").

**What's measurable:** reach (278K) is large and real. **Outcome is NOT in Apollo** — SMS has no delivery/open events in `apollo_sdk_notification` (that table is push/IAM only), and `apollo_campaign_summary` outcome cols are null for jus_vn.

**Effectiveness measurement plan (requires join, not yet run):**
1. Resolve segment `1984112625036202000` membership → uids. **Blocker:** portal `segment_id` (campaign_summary) vs `std_past_segment.internal_segment_id` are different id spaces (unproven linkage — see Q's). If they reconcile, pull members.
2. Join uids → `jus_vn` revenue cube; compare 14-day pre vs post-send recharge for the SMS cohort vs a matched paying cohort not sent.
3. Without the member list, fall back to *aggregate* paying-user revenue trend around 2025-11-05 (directional only, confounded by the "511" event itself).

**Verdict:** highest-reach real campaign, but effectiveness is currently **un-attributable inside Apollo** — exposes the gap that SMS/email campaigns have no outcome table. Flag for the feature: if SMS ROI matters, we need the segment-member → revenue join wired (and the segment-id reconciliation solved).

## 6. Deep dive #3 — cfm_vn "VNG MMO / CBG Churn Re-targeting" (Meta + TikTok)

**What it is:** 4 campaigns (Dec 2025–Jan 2026) re-targeting *churned* cfm players via external ads. Two audiences — **MMO** (segment `2001148077735841800`) and **CBG** (segment `2001149244459131000`) — each exported to **both Meta and TikTok** (`sent=0` = audience-export, not in-app send). This is the textbook Apollo "Past Segment → external paid winback" flow.

**What's measurable here:** essentially the audience size (segment `userIdCount` in `view_apollo_portal_segment`) and the fact of export. **Conversion happens off-platform** (ad impression → reinstall → login), so Apollo holds no outcome. Attribution would require: segment uids → `mf_users` reinstall/return signal (`sdk_first_login` after churn) → revenue, *and* ad-platform spend/impression data (not in this bucket; lives in the cost feed referenced by `mf_users.media_source/campaign_id`).

**Verdict:** strategically the most "liveops" of the three (segmented cross-channel winback), but the **least measurable from `pro_apollo` alone**. Useful as the motivating use-case for a *return-detection* enrichment (did exported-churn uids come back?), which IS computable by joining segment members to `mf_users` login recency — the one piece feasible without external data.

---

## 7. What this means before committing features

1. **Outcome data is thin and uneven.** Only promotion-engine campaigns (lucky-wheel/gift) carry revenue+funnel. Push/IAM = mostly tests; SMS/email = reach-only; ad-export = off-platform. A generic "campaign ROI dashboard" would be empty for ~90% of rows today.
2. **Highest-confidence first feature:** a **promotion-outcome cube** for cfm_vn/jus_vn off `dash_promotion_daily` (gross/played/turns per promotion/day) + `dash_promotion_play` (per-user, joinable to `mf_users`). This is fully proven and immediately useful.
3. **Second:** **segment-membership + return/retention** enrichment (`std_past_segment` + segment export sizes) — powers churn-winback measurement, the use case behind dive #3. Needs the segment-id reconciliation (Q1) and the OOM-safe snapshot pattern.
4. **Defer** any push/IAM "engagement ROI" surface until real (non-test) push volume exists for our two games.

---

## Appendix — queries used (read-only, `scripts/trino-query.mjs`)

```sql
-- census
SELECT product_code, channel, status, count(*), sum(sent_message)
FROM iceberg.pro_apollo.apollo_campaign_summary
WHERE product_code IN ('A49','A70') GROUP BY 1,2,3;

-- lucky-wheel revenue + daily curve
SELECT log_date, qualified_identifier, played_users, achievement_turn, gross_amt
FROM iceberg.pro_apollo.dash_promotion_daily
WHERE product_code='A49' AND promotion_id='2011288550702137344' ORDER BY log_date;

-- participant -> mf_users join proof (100% for lucky-wheel)
WITH p AS (SELECT DISTINCT split_part(identifier_id,':',2) uid
           FROM iceberg.pro_apollo.dash_promotion_play
           WHERE product_code='A49' AND promotion_id='2011288550702137344')
SELECT count(*) players, count(m.user_id) matched
FROM p LEFT JOIN game_integration.cfm_vn.mf_users m ON p.uid=m.user_id;
```

## Unresolved questions

1. **Segment-id reconciliation** — `apollo_campaign_summary.segment_id` / `view_apollo_portal_segment.id` (portal `_id`) vs `std_past_segment.internal_segment_id` vs `dash_promotion_play.segment` ("Segment 1"). These look like 3 different id spaces; blocks segment-member → outcome joins for non-promotion campaigns (dives #2/#3).
2. **Incremental lift** — lucky-wheel `gross_amt` is wheel-spend, not proven incremental revenue; need a holdout/pre-post baseline to claim ROI. Is a control group available?
3. **identifier_id 3rd/4th segments** — `A49:{uid}:{n}:{101}` — what are the trailing fields (role id? server? promotion-instance?); confirm before treating uid as the only key.
4. **Revenue cube for the join** — which cfm_vn/jus_vn measure is the canonical post-campaign revenue (recharge vs billing_detail) to attach to participants? (revenue_vnd_real is cfm-only per prior notes.)
5. **dash_promotion freshness** vs Apollo portal CDC lag — not measured; affects whether a near-real-time campaign board is feasible.
