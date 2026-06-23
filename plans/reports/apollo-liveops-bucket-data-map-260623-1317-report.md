# Apollo LiveOps Bucket — Data Map & Cube-Playground Enrichment

Date: 2026-06-23 (GMT+7) · Source: `iceberg.pro_apollo` (Trino, via `scripts/trino-query.mjs`) + Confluence space `apo`

## TL;DR

- **Apollo = the Grow/GROW-Portal segmentation + engagement engine.** Game Studios author *segments* (RFM / Past / Live) and run *campaigns* (Push, In-App Message, SMS, Email, ZNS, Journey/automation) against them. It also exports audiences to Meta/TikTok and integrates with the Promotion engine (gifts/missions by segment).
- **`iceberg.pro_apollo` has 33 tables.** Three layers: Apollo portal CDC tables (`apollo_portal_*`), engagement event/aggregate tables (`apollo_sdk_notification`, `apollo_campaign_summary`, `pusher_push_tracking_v1`, `std_past_segment`), and a Promotion-engine sub-bucket (`promotion_engine_*`, `dash_promotion_*`).
- **KEY UNLOCK — direct join, no bridge.** Apollo `user_id` is the **same 19-digit snowflake namespace as `game_integration.{game}.mf_users.user_id`**. Verified overlap: **999,443 / 1,085,610 = 92%** of Apollo's A70 (Justice-VN) segment uids matched `jus_vn.mf_users`. This means segment membership, push/IAM engagement, and campaign exposure can be attached to existing cube users with a plain equi-join.
- **Our two live cube games are present:** product_code `A70` = Justice-VN (`jus_vn`, 82 campaigns, live+running) and `A49` = Crossfire Legends-VN (`cfm_vn`, 14 campaigns, onboarding-in-progress per 12-May sync-up). PlayTogether (`661`) dominates volume (880 campaigns, 2.6B sends).

---

## 1. What Apollo is (Confluence-confirmed)

Space `apo` / "GROW Portal". Operators with a Business Operator role create campaigns. Core model:

**Segment types** (`LiveOps Engine BRD`, `Apollo System Architecture 01/2025`):
| Type | Purpose | Notes |
|------|---------|-------|
| **RFM / Cohort** | Lifecycle + behavioral segmentation | persona analysis before campaign |
| **Past Segment** | Historical + external targeting | exportable to Meta/TikTok ad accounts |
| **Live Segment** | Real-time personalization / automation | evaluated continuously |
| Churn Segment | (in dev per Plan Q3) | |

**Campaign / channel types:** Push Notification (one-time + real-time), In-App Message (IAM), SMS, Email, ZNS (Zalo), plus **Journey Builder** automation flows. Campaigns target a segment + an asset, scheduled with start/end.

**Onboarding status (12-May Apollo sync-up):** live & running = *PlayTogether, Justice Mobile (jus_vn)*; onboarding = *Cookie Run, Total Football, **CFM (cfm_vn)***. Matches the campaign counts below.

**Promotion integration:** "Custom gift & mission by segment" — Apollo segments drive the Promotion engine; that engine's tables live in the same bucket (`promotion_engine_*`).

---

## 2. Table inventory (`iceberg.pro_apollo`, 33 tables)

### A. Apollo portal — campaign/segment authoring (CDC mirrors, `__op`/`__ver` debezium cols)
| Table | Grain | Key columns |
|-------|-------|-------------|
| `apollo_portal_campaign_v3` | 1 row / campaign | `_id`, `name`, `objective`, `channel`, `delivertype`, `status`, `gamecode array`, `segmentids array`, `assetid`, `starttime`/`endtime` (epoch ms), rich `metadata row(...)` (notification/SMS push info, audience export status, ad-account sharing) |
| `apollo_portal_segment` | 1 row / segment | `_id`, `name`, `type`, `status`, `objective`, `gamecode array`, `audience row(userIdCount, phoneCount, emailCount, deviceId[], deviceToken[])`, `conditionjsontree` (nested filter logic) |
| `apollo_portal_asset_v4` | 1 row / creative asset | `_id`, `name`, `type`, `gamecode array(row(productCode, region, market,...))`, `metadata row(promotionId, campaignSlug, collapsedModeUrl)` |
| **`view_apollo_portal_campaign`** | flattened campaign | clean: `id`, `channel`, `name`, `objective`, `segment_id`, `game_code` (scalar), `start_time`/`end_time` (timestamp), `status` |
| **`view_apollo_portal_segment`** | flattened segment | clean: `id`, `segment_name`, `segment_type`, `objective`, `status`, `game_code`, `user_id_count`, `phone_count`, `email_count`, `device_*_count` |
| `view_portal_segment`, `view_sdk_notification_summary`, `view_apollo_*` | curated views | prefer these over raw CDC |

### B. Engagement / outcome tables (the enrichment gold)
| Table | Grain | Key columns | Notes |
|-------|-------|-------------|-------|
| **`apollo_campaign_summary`** | campaign × month | `campaign_id`, `name`, `channel`, `status`, **`product_code`**, `product_name`, `dept`, `segment_id`, `start_time`/`end_time`, **`sent_message`, `qualified_user`, `user_play`, `user_paid`, `achievement_turn`** | Pre-aggregated campaign funnel. Cleanest single enrichment source. |
| **`std_past_segment`** | user × segment × snapshot | **`user_id`**, **`product_code`**, `target_product_code`, `internal_segment_id`, `logtime`, `ds` (date) | Historical segment membership. **Huge** (full group-by OOM'd at 54GB/node — query scoped). Joins to `mf_users.user_id`. |
| **`apollo_sdk_notification`** | per push/IAM event | `user_id`, `game_id`, `campaign_id`, `event_type`, `interaction_type`, `event_time`, `log_date`, nested `notification_data row(apo_campaign_id, msgId, inbox{...}, ...)`, device/appsflyer ids | Full delivery+interaction event stream. |
| **`pusher_push_tracking_v1`** | campaign × ref | `campaignid`, `referenceid`, `channel`, `productcode`, `counters map(varchar,bigint)`, `type` | Per-campaign counter rollups. |

`apollo_sdk_notification` event vocabulary (≥2026-06-01): `token` (device-token registration, 118M), `out-app` = push (`opt-in` 100M / `opt-out` 29M / `received` 10M / `dismissed` 4M / `open` / `clicked`), `in-app` = IAM (`impression` 6M / `close` / `received` / `read` / `open` / `clicked`). → full opt-in→delivered→opened→clicked funnel.

**Third game-code namespace (heads-up):** `apollo_sdk_notification.game_id` is *neither* the cube slug *nor* the FA product_code — it's an uppercase code: `CFMVN`, `JUSVN`, `PTG`, `ZSM`, `JXM`, `TFSEA`, `KTOVN`, `BALLISTARVN`, `NIKKI`, `GNM`, … So cfm_vn=`CFMVN`, jus_vn=`JUSVN`. **Both have heavy engagement volume here even though cfm's *portal* campaign count is tiny:** CFMVN `out-app` = 226M events / 2.5M uids; JUSVN `out-app` = 23M / 236K uids; CFMVN `token` = 340M / 1.5M uids. → cfm_vn liveops engagement IS rich at event level despite "onboarding" portal status. Mapping these three code systems (slug / product_code / game_id) is a prerequisite for any cross-table cube.

### C. Promotion engine sub-bucket (segment-driven gifts/missions)
`promotion_engine_promotion`, `_gift`, `_gift_pool`, `_gift_pool_schema`, `_task_reward`, `_counter`, `_user_play_history`, `_user_schema`, `_promotion_user_schema_config`; dashboards `dash_promotion_daily/_gift/_play/_taskreward/_user`; `view_promotion_engine_*`, `view_promotion_map_product_code`. → what gift/mission a segment received and whether the user played/claimed.

### D. CDP / profile & misc
| Table | Notes |
|-------|-------|
| `rws_user_profile_v1/v2/v3` | CDP/AppsFlyer profile: `game_id` (single value `"rws"`), `user_id`, `media_source`, `campaign_id`, `adset_id`, `vip_level`, `total_rev`, install/charge times. **Only 257K rows, `game_id` not per-game, max `ds`=2026-02-09 (stale).** Low value vs our own `mf_users`. |
| `counter`, `test`, `_corrupt_record` cols | infra/debug — ignore |

---

## 3. Product-code ↔ cube-game map (from `apollo_campaign_summary`)

Apollo uses VNG FA product codes, **not** the cube game slug. Verified mapping for codes that matter:

| Apollo `product_code` | `product_name` | Cube game | Apollo campaigns | sent_message |
|---|---|---|---|---|
| **A70** | Justice-VN | **`jus_vn`** | 82 | 319K |
| **A49** | Crossfire Legends-VN | **`cfm_vn`** | 14 | 14 (onboarding) |
| 661 | Play Together | (not in cube) | 880 | 2.63B |
| 647 / C05–C07 | Ballistic Hero (Global/VN/ID/TW) | ballistar* | 97 + … | 1.5M |
| 251 | Gun Pow | gunpow | 33 | 114K |
| 377 | Zingspeed Mobile | zsm | 27 | |
| A86 | Total Football-VN | tf | 23 | 13K |
| 122/016/495 | Gunny family | gnm/gno… | | |
| 381 | Danh Tướng 3Q | dt3q | 14 | |
| 384 | PUBG Mobile | pubgm | 9 | |
| 946 | MU Angel War | muaw | 11 | 56K |

Some `product_code` rows are comma-joined multi-game (`664,665,668,669`) — campaigns spanning regions. A lookup view exists: `view_promotion_map_product_code`. Coverage spans **2025-01 → 2026-06** (and future-dated scheduled campaigns to 2026-06-27).

---

## 4. How it enriches cube-playground (ranked)

The join spine: `apollo.{user_id} = game_integration.{game}.mf_users.user_id`, scoped by `product_code` ↔ game. Verified 92% hit on jus_vn.

**Tier 1 — high value, low effort**
1. **Segment membership dimension on users** (`std_past_segment`). Attach "which Apollo segments a uid belongs to" → enables cube segments like *"users in Apollo RFM-whale segment"*, *"reached by churn-winback segment"*. Directly complements our own Segments product (Apollo is the platform-side counterpart). Caveat: table is massive → serve via a per-game, latest-`ds` filtered pre-agg or nightly snapshot (same pattern as our segment-membership lakehouse snapshot).
2. **Campaign-exposure + outcome on users** (`apollo_sdk_notification` + `apollo_campaign_summary`). New measures per user: was-targeted, received, opened, clicked, and campaign-level `qualified_user / user_play / user_paid / achievement_turn`. Enables *"did liveops touch lift D7 revenue / retention"* analysis against existing `pmt_user_daily` / `mf_users` — i.e. closed-loop campaign effectiveness, which our chat-service experiment rail currently lacks a real treatment source for.

**Tier 2 — campaign catalog as a first-class cube**
3. **Campaign + segment catalog cubes** (`view_apollo_portal_campaign`, `view_apollo_portal_segment`, `apollo_campaign_summary`). A `liveops_campaign` cube (per game): name, channel, objective, status, window, segment, funnel measures. Powers a LiveOps campaign dashboard alongside existing `/liveops` cohort grid — Apollo is literally "the tool running liveops campaigns," so this is the native home.
4. **Promotion outcomes** (`promotion_engine_*` / `dash_promotion_*`): gift/mission claim + play history per segment → connects "segment got gift X" to "claimed / played". Pairs with the Promotion platform product already in the company-context seed.

**Tier 3 — situational**
5. Push deliverability health (`pusher_push_tracking_v1`, token opt-in/opt-out rates) — ops monitoring, not user analytics.
6. `rws_user_profile_*` — **skip**; stale, not per-game, and our `mf_users` already has richer acquisition (media_source/campaign_id) for the same uids.

---

## 5. Caveats & data-quality notes

- **product_code is the join discriminator, not game slug.** Must map A70→jus_vn, A49→cfm_vn etc. Multi-code rows (`664,665,...`) exist. Use `view_promotion_map_product_code` as the authority.
- **`std_past_segment` is enormous** — a naive `GROUP BY` across all of it exceeded the 54 GB per-node Trino memory limit. Any cube on it must be `product_code` + `ds`-pruned and likely pre-aggregated (mirror our existing segment-snapshot job, don't query raw at request time).
- **CDC tables** (`apollo_portal_*`) carry debezium `__op`/`__ver` and tombstones — prefer the `view_*` flattened layer.
- **`apollo_sdk_notification`** is event-grain and large; `event_type='token'` rows (118M) are device-token churn, not campaign events — filter to `out-app`/`in-app` for engagement. Its **top-level `campaign_id` column is almost always null** (`count(distinct campaign_id)`≈0 for most game/event groups) — the real campaign link is the nested `notification_data.apo_campaign_id`. Join events→campaigns through the nested field, not the column.
- **Dirty `log_date` / `event_time`** in `apollo_sdk_notification`: observed `max(log_date)` values like `2095-02-21`, `2476-05-11`, `2037-04-02` — garbage future timestamps present. Any time-windowed cube must clamp to a sane upper bound (cf. our existing rollup `build_range_end` cap practice).
- **cfm_vn (A49) is only onboarding** — 14 campaigns, 14 sends. jus_vn (A70) is the only one of our two cube games with meaningful Apollo volume today.
- **8% of A70 segment uids don't match `mf_users`** — likely phone/email-only audiences or cross-product uids; expected, not a defect (Apollo segments include non-game-uid audiences for Meta/SMS export).
- Apollo `user_id` matching `mf_users.user_id` (the resolved canonical id) sidesteps the per-game raw-event identity mess (cfm vopenid, jus `@`-split) — those live in raw event tables, not `mf_users`.

---

## 6. Suggested next step (not yet done)

If we pursue this: a small **`liveops_campaign` + `user_segment_membership` cube pair** scoped to jus_vn first (the only game with volume), fed by a `product_code`-filtered nightly snapshot of `std_past_segment` + `apollo_campaign_summary`, joined to `mf_users.user_id`. That gives the playground its first platform-side liveops surface and a real treatment source for the experiment/closed-loop rail.

## Unresolved questions

1. **Refresh cadence / freshness SLA** of `std_past_segment` and `apollo_sdk_notification` (`ds`/`log_date` lag vs. our nightly cube builds) — not measured.
2. **`internal_segment_id` → segment name** linkage: `std_past_segment.internal_segment_id` vs `apollo_portal_segment._id` / `view_apollo_portal_segment.id` — same id space? Needs a join test to confirm before building a named-segment dimension.
3. **`campaign_id` namespace** consistency: `apollo_campaign_summary.campaign_id` (varchar) vs `apollo_portal_campaign_v3._id` (bigint) vs `apollo_sdk_notification.campaign_id` — verify they reconcile before cross-table funnel joins.
4. Whether to model the **Promotion engine** here at all, or treat it as a separate bucket/product (it has its own `dash_*` layer).
5. Is `iceberg.pro_apollo` the prod bucket the cube serving instance can actually reach, or is a `stag_iceberg` copy needed for the playground's eval/local lanes?
