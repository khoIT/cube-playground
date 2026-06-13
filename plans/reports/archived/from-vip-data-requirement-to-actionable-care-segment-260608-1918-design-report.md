# VIP Data Requirement → Actionable Care Segment (jus_vn)

**Source doc:** `VIP_Data_Requirement_Final.docx` — "VIP Care Program — Trigger & Data Requirement", game = Nghịch Thủy Hàn (`jus_vn`), Pilot, 06/2026.
**Goal:** turn the generic `vvip whale` segment into a CS-actionable surface: filter condition + watched metrics + triggers + playbook (action/channel/KPI).

---

## 1. What the document actually specifies

Not a data spec — a **trigger→action playbook**. 21 triggers in 4 groups. Each row carries 6 reusable parts:

| Doc column | Meaning | Maps to product concept |
|---|---|---|
| Điều kiện kích hoạt | filter / threshold condition | **predicate** (segment membership OR per-member trigger rule) |
| Metric đo lường | metric to track after firing | **watched metric** (Cube measure, cohort + member grain) |
| KPI | target threshold for that metric | **goal / alert threshold** on the watched metric |
| Hành động | what CS does | **playbook action** |
| Kênh liên hệ | in-game / Zalo / call / push | **playbook channel** |
| Ưu tiên / Data fields | priority + required fields | scheduling + data-availability gate |

### The 21 triggers
- **NHÓM 1 — Nạp tiền (payment):** 01 first deposit · 02 reach VIP tier (5/20/50/100M cumulative) · 03 spend spike (single ≥10M or daily ≥20M vs personal avg) · 04 spend drop (7d < 30% of 30d avg) · 05 payment failure (>2 fails/session).
- **NHÓM 2 — In-game behavior:** 06 top leaderboard (rank ≤10) · 07 Thiên Tứ cosmetic unlock · 08 rank drop / loss streak · 09 achievement (server #1) · 10 guild instability · 11 collector FOMO (4/5 set owned) · 12 gacha bad-luck floor · 13 negative sentiment (chat keyword scan).
- **NHÓM 3 — Churn risk:** 14 no login (≥3/5/7d by tier) · 15 session-time drop (7d < 40% of prior 30d) · 16 negative ticket/complaint · 17 leave/disband guild.
- **NHÓM 4 — Time & event:** 18 anniversary (30/90/180/365/730d) · 19 pre-major-patch (ops calendar) · 20 new faction/server (ops event) · 21 birthday.

---

## 2. What Segments supports today

Segment = **saved predicate cohort** (`server/src/types/segment.ts`):
- `predicate_tree_json` — AND/OR tree of Cube filter leaves `{member, op, values}` (`predicate-tree.ts`). Ops: equals, gt/lt/gte/lte, in, set/notSet, inDateRange, before/afterDate.
- Resolved to a UID list on a **refresh cadence** (cron worker → Cube query → `uid_list_json`, capped 100k) or manual CSV import.
- `game_id` + `workspace` scoping; visibility ladder; tags; **member-360** per-user panel (`/segments/:id/members/:uid`); LTV-tier ranking.
- `activations_json` — **CDP activation registry but it is a stub** (no real push).
- Seeded VIP segments exist for `ballistar` ("top VIP players" = `mf_users.is_paying_user = true`; "VIP Beta Whitelist" manual). No `jus_vn` whale segment in `server/data/seed/segments-snapshot.json` — the live one lives in the running gateway DB.

**The vvip whale segment is therefore already creatable today** as a predicate: `payer_tier = whale` (or `ltv_vnd >= 10M`) `AND lifecycle_stage IN (active_today, active_7d)`.

### The gap (why it isn't "actionable" yet)
A segment today is a **static list**. It has no:
1. **Watched metrics** attached to the cohort (ARPU 30d, churn, session, days-since-login).
2. **Per-member triggers** — rules that flag *individual* members when a condition crosses (the whole point of the doc).
3. **Playbook** — action + channel + SLA + KPI target per trigger.
4. **CS worklist** — an inbox of fired alerts → pick up → see member-360 → log outcome.

---

## 3. jus_vn data reality — what's buildable now vs blocked

Live model: `cube-dev/cube/model/cubes/jus/*` (per-game bare cubes) + view `views/jus/user_360.yml`.

**Per-user grain available (`mf_users`, one row/user):** `user_id`, `ltv_vnd` / `ltv_30d_vnd` / `ltv_usd`, `lifetime_txn_count` / `txn_count_30d`, `ltv_iap_vnd` / `ltv_web_vnd`, `max_vip_level`, `max_role_level`, `is_paying_user`, `payer_tier` (incl. `whale`), `lifecycle_stage`, `churn_risk`, `days_since_last_active`, `first_active_date` / `install_date`, `last_active_date`.
**Per-user-per-day:** `user_recharge_daily` (revenue, vip_level, payment_channel, txn counts) · `active_daily` (`online_time_sec`).

| Trigger | Buildable today? | Field / blocker |
|---|---|---|
| 02 VIP tier reached | ✅ | `max_vip_level`, `ltv_vnd` thresholds |
| 03 spend spike | ✅ (window) | `user_recharge_daily` daily revenue vs personal avg |
| 04 spend drop 7d<30% | ✅ (window) | `user_recharge_daily` 7d vs 30d |
| 14 no login ≥N days | ✅ | `days_since_last_active` (tier-stepped) |
| 15 session drop | ✅ (window) | `active_daily.online_time_sec` 7d vs 30d |
| 18 anniversary | ✅ | `first_active_date` + day offsets |
| 01 first deposit | ⚠️ | need first-deposit event flag (derivable from recharge but not modeled) |
| 19/20 patch / faction | ⚠️ manual | ops-calendar input, not a data trigger |
| 05 payment failure | ❌ | no failed-txn data in model (only successes) |
| 06/08/09 rank/leaderboard | ❌ | no rank/leaderboard cube |
| 07 cosmetic unlock | ❌ | no item/cosmetic ownership cube |
| 10/17 guild | ❌ | no guild/clan cube |
| 11 collector FOMO | ❌ | no item-collection cube |
| 12 gacha bad-luck | ❌ | no gacha-roll cube |
| 13 sentiment | ❌ | no chat/sentiment cube |
| 16 negative ticket | ❌ | no support-ticket cube |
| 21 birthday | ❌ | no `birth_date` / demographics |

**Verdict: ~6–7 of 21 triggers are buildable on today's jus_vn model** (all of NHÓM 1's spend-based + NHÓM 3's behavior-based + anniversary). The remaining ~14 need new Cube models (rank snapshot, guild, items/cosmetics, gacha, sentiment, tickets, demographics, payment failures) — a data-team dependency, not a frontend one.

---

## 4. How a user creates an "actionable VIP-care segment" (proposed design)

Extend the existing Segment, do **not** build a parallel feature. A "Care Program" segment = **base cohort + watched metrics + triggers + playbook**.

### 4.1 Base cohort (exists today)
Predicate: `payer_tier = whale AND lifecycle_stage IN (active_today, active_7d)`. This is the vvip whale segment — unchanged.

### 4.2 Watched metrics (new — `watched_metrics_json` on segment)
List of Cube measures monitored at **cohort + member** grain, with optional KPI target:
```
[{ member: "mf_users.ltv_30d_vnd", label: "ARPU 30d", goal: ">= 1.1x prior" },
 { member: "mf_users.churn_risk",   label: "At-risk %" },
 { member: "active_daily.online_time_sec", label: "Avg session 7d" }]
```
Render as a metric strip on segment detail and inside member-360. Reuses the card-cache/preset query plumbing.

### 4.3 Triggers (new — per-member alert rules)
Each doc trigger = a predicate evaluated **per member** on the refresh cadence. Reuses `predicate-tree.ts` + the existing refresh worker + `translator.ts`. When a member crosses, emit a `care_alert` row `{segment_id, uid, trigger_id, fired_at, status}`. Conditions map 1:1 to predicate leaves where data exists (§3).
```
trigger "Spend drop": rolling_7d_spend < 0.3 * rolling_30d_avg   → flag member
trigger "No login":   days_since_last_active >= {3|5|7 by tier}  → flag member
```

### 4.4 Playbook (new — promotes the `activations` stub)
Per trigger attach `{action, channel, sla, kpi_target}` straight from the doc's columns (Hành động / Kênh / KPI). Channels: in-game, Zalo ZNS, call, push.

### 4.5 CS worklist (new surface)
Inbox of fired `care_alert`s across VIP segments → CS opens member-360 (exists) enriched with: which trigger fired, recommended action + channel + SLA, watched-metric trend → logs outcome (contacted / resolved / KPI met). Closes the loop from "list of UIDs" to "queue of people to take care of, with why + what to do."

### Data-model deltas (minimal)
- `segments.watched_metrics_json` (TEXT) — new column.
- `segments.triggers_json` (TEXT) — array of `{id, label, predicate_tree, action, channel, sla, priority}`.
- new table `care_alerts {id, segment_id, uid, trigger_id, fired_at, status, outcome, assignee}`.
- refresh worker extended to evaluate triggers per-member and upsert alerts.
- everything else (predicate builder, member-360, refresh, scoping, RBAC) is reused.

---

## 5. Recommended pilot scope

Ship the **mechanism** against the **6–7 buildable triggers** so CS gets value on real jus_vn data now, and the same trigger/playbook engine absorbs the blocked triggers as the data team lands new cubes.

- **Phase 1 (frontend-only, today's data):** watched-metrics + triggers + playbook + CS worklist, wired to NHÓM 1 spend triggers (02/03/04), NHÓM 3 (14/15), anniversary (18).
- **Phase 2 (data-team dependency):** new cubes (rank, guild, tickets, sentiment, gacha, items, demographics, payment-failures) → unlock NHÓM 2 + remaining churn/event triggers. No frontend rework — just new `member`s available to the same predicate/trigger builder.

---

## Unresolved questions
1. **VIP tier thresholds** — doc says 5/20/50/100M cumulative for tiers; `mf_users.max_vip_level` is a numeric game level. Confirm whether tiering keys off `ltv_vnd` bands or in-game `vip_level`.
2. **First-deposit flag** — derivable from recharge history but not modeled; add as `mf_users` dimension or compute in trigger query?
3. **Trigger evaluation cadence** — refresh worker runs on segment cadence; payment-failure / sentiment triggers in the doc imply near-real-time (5–15 min SLA). Is segment-cadence batch acceptable for pilot, or do hot triggers need a streaming path?
4. **Where does the live jus_vn whale segment live** — not in seed snapshot; confirm it's a runtime gateway-DB row so we extend the right record.
5. **CS action logging** — does outcome logging stay in-product (new `care_alerts.outcome`) or hand off to an external CRM/Zalo ZNS system?
