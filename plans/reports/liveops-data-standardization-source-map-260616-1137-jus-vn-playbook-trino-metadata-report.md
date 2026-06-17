# LiveOps Data Standardization — Source Map (JUS / Nghịch Thuỷ Hàn)

**Date:** 2026-06-16 (GMT+7) · **Author:** khoitn · **Scope:** cross-reference 3 sources for the JUS game

Three sources joined:
1. **SharePoint** — LiveOps team "Data Standardization" folder (playbook + Kafka/file log samples).
2. **Trino `game_integration`** — current data actually supported (live, queried).
3. **`metadata.gds.vng.vn` dataProduct** — data-platform centralized catalog (OpenMetadata).

---

## 0. Headline

- The LiveOps "Data Standardization" effort currently has **exactly one game standardized: JUS** (folder `NTH` = *Nghịch Thuỷ Hàn* = `jus_vn`). No other game folder exists yet.
- JUS data in Trino `game_integration` is **fully present and matches the playbook 1:1** — every Kafka event the playbook lists has a backing table. Split across **two schemas**: `jus_vn` (42 standardized tables) + `bi_jus_vn` (29 raw gameplay-event tables).
- The **data-platform portal DOES catalog the standardized layer** (correction to an earlier draft): the `jus_vn` dataProduct links **50 assets** — including the `trio-game.game_integration.jus_vn.*` Trino std tables, the `clickhouse.default.gds.jus_vn_*` masterfiles, and the Kafka topic `kafka-gio.jus_vn-realtime`. The "7 assets" in the dataProduct *description* is stale auto-detect text, not the live count. **Real gap:** the `bi_jus_vn` gameplay-event tables (29) are **not** linked to the dataProduct.

---

## 1. SharePoint folder ("Data Standardization")

```
Documents/LiveOps Platform/Data Standardization/
└── NTH/                              # NTH = Nghịch Thuỷ Hàn (JUS)
    ├── NTH_LIVEOPS_PLAYBOOK.docx     # "NTH LiveOps Data Playbook v1.0"
    └── jus_vn/
        ├── jus_file_samples.xlsx     # daily file-log samples (same content as kafka, diff channel)
        └── jus_kafka_samples.xlsx    # realtime Kafka topic samples (one record per event type)
```

Owner: `nhily2`. Intent (per folder): make the available data transparent for LiveOps/data teams.

### 1a. Playbook summary (`NTH_LIVEOPS_PLAYBOOK.docx`)

Purpose: use JUS realtime logs to segment users → push actions via **CleverTap / AppsFlyer Audiences / CSKH 1-1**. MMORPG mobile+PC, Vietnam, launch **2025-11-07**.

**Part 1 — Conventions (mandatory):**
- **Channels:** daily file log (`jus-*.log`) **and** Kafka topic — *same content, different channel*.
- **Server scope:** commercial default **5** servers `3500–3504`; cross-server org servers `3410,3411` (PVP/Garden/Đoàn Phim — logged by org server, not user's register server); CBT `851,820,821,824` (lifetime-pay only).
- **Identity:** `account_id` = SDK uid `"uid@vng_vie.win.163.com"` → `SPLIT_PART(account_id,'@',1)`; `role_id` = ingame char `<role_seq><server>`; 1 account → many roles; primary role = MAX lifetime `online_time`.
- **Profile snapshot** (Login/Logout): `role_class` (1-8), `role_gender`, `role_level`, `guild_id`, `total_score` (combat power).
- **Time:** log header `+0700`; `tsforvng` = unix epoch **UTC** → `FROM_UNIXTIME(tsforvng) AT TIME ZONE 'Asia/Ho_Chi_Minh'`. In-game week = Mon 05:00 → next Mon 04:59:59.
- **Base filter:** `server IN (3500..3504) AND region='SEASIA' AND country_code='VN' AND tsforvng >= launch`.
- **Currency:** VND; multi-SEA currencies converted via IAP lookup `prepaid_detail_item_id` (NEVER `SUM(cash)` raw).
- **VNG 8-tier** (lifetime_pay_vnd, 9-server scope): Tân Thủ <150K → … → Vô Song ≥200M (VVIP, 152 accounts as of 19/05/2026).

**Part 2 — Log Inventory:** ~30 realtime event types (all dual file+Kafka). Raw format: `timestamp gas_<server>[pid]: [datetime +0700][EventType],{JSON}`.

**Part 3 — Segmentation framework** (5-col schema: STT / Định nghĩa / Key Log / Action Type / Liveops Action):
- Lifecycle (NRU, Active D7, At-risk, Churned, Returnee, Bot suspect)
- Monetization (VNG tier, spend pattern, currency behavior via money_flow `field`/`reason` codes, Whale Watch top-1000 risk)
- Gameplay 5-motif (PVP / PVE-proxy via TreasureUnlock / NPC-romance / Garden+Fashion / Open-World-proxy via GetAchieve)
- Session quality, Gacha (pity-180, premium item `21203146`), Profile-based, Cross-segment combos
- **Notable insight:** *46.7% NRU stuck at Lv1 forever* → flagged P0 onboarding issue.

**Part 4 — Reference & 14 Gotchas:** cross-server UNION (G1), raw JSON regex parse (G2), multi-currency (G3), physical week (G4), `TreasureUnlock`=all weekly missions not just PVE (G5), Garden+Fashion=INTERSECT (G6), `GetAchieve`=OW proxy (G7), per-account vs per-role NRU (G8), tsforvng UTC vs +0700 (G11), lifetime 9-server scope (G12), ScoreBoost newbie-only (G13), gacha pity (G14).

### 1b. Sample workbooks

`jus_kafka_samples.xlsx` = one real record per event type. Confirmed event types in samples:
`ClientCheatLog, CommonCalcLevelAndWinPoint, ConsumeItem, ConsumeItemNoDel, ConsumeLiveHuoLi, CreateRole, FashionClothes_Change, FuXiNpcPlayerSay, GardenFarmAnimalHarvest, GardenFarmCropHarvest, GardenMakeHarvest, GardenPlaceUnit, GardenRemoveUnit, GardenShopBuyBegin, GardenShouGouItemBegin, GetAchieve, GetMoney, LoginRole, LogoutRole, NPCIMChat, NpcIM_SendGift, NpcIM_Talk, NpcIM_Tour, OnlineRoleNum, OnlineRoleNumForSEA, PlayerAddItem, PlayerSendGiftToFuXiNpc, Prepaid, RiKe, ScoreBoostRiseBigRank, ScoreBoostSetSubRankCert, TreasureUnlock, Upgrade, UpgradeEquip, UseMoney`.
`jus_file_samples.xlsx` = same set in daily-file format (not separately re-read — playbook states identical content).

---

## 2. Trino `game_integration` — current data supported

JUS occupies **two schemas**:

### 2a. `game_integration.jus_vn` — standardized common core (42 tables)
The canonical LiveOps/BI layer (5-prefix taxonomy `etl_ / std_ / cons_ / mf_ / map_`):

- **etl_ingame_** (raw→typed core): `login, logout, register, recharge, money_flow, item_flow, ccu, npc_im_tour, garden_farm_crop_harvest`
- **std_ingame_** (standardized marts): `role_active(_daily/_monthly), role_recharge(_daily/_monthly), user_active_daily/monthly, user_recharge_daily/monthly, info_active_user, garden_farm_crop_harvest, npc_im_tour`
- **cons_** (consumption/reporting marts): `game_key_metrics_daily/monthly, server_key_metrics_daily/monthly, game_user_active_daily/monthly, game_user_recharge_daily/monthly, game_new_user_retention_daily/monthly, game_cumulative_rev_by_new_user_daily, game_recall_user_active/recharge_monthly`
- **mf_** (master files / identity): `mf_users, mf_ingame_roles, mf_ingame_devices, mf_ingame_ips`
- **map_** (bridges): `map_ingame_devices_and_userid, map_ingame_ips_and_userid`
- **marketing:** `std_marketing_cost_all_channels_by_game`

### 2b. `game_integration.bi_jus_vn` — game-specific gameplay events (29 tables)
The rich behavioral layer that powers Part-3 segments:
`commoncalclevelandwinpoint, treasureunlock, getachieve, rike, scoreboostrisebigrank, scoreboostsetsubrankcert, huoli, upgrade, upgradeequip, zpresult, fashionclothes_change, money_flow, npcim_sendgift, npcim_talk, npcim_tour, npcimchat, fuxinpcplayersay, playersendgifttofuxinpc, gardenfarmanimalharvest, gardenfarmcropharvest, gardenmakeharvest, gardenplaceunit, gardenremoveunit, gardenshopbuybegin, gardenshougouitembegin, shopitembuy, trade, entermap, leavemap`

(Liveness confirmed: `bi_jus_vn.etl_ingame_treasureunlock` = 3,990,795 rows.)

### 2c. Playbook event → Trino table mapping (coverage = COMPLETE)

*Method: manual eyeball cross-map of the playbook Part-2 event list vs the two `SHOW TABLES` outputs — not a programmatic name join. "Complete"/"only ClientCheatLog" are review assertions, not machine-verified.*

| Playbook Kafka event | Trino table | Schema |
|---|---|---|
| LoginRole | etl_ingame_login | jus_vn |
| LogoutRole | etl_ingame_logout | jus_vn |
| CreateRole (register) | etl_ingame_register | jus_vn |
| Prepaid (recharge) | etl_ingame_recharge | jus_vn |
| GetMoney / UseMoney | etl_ingame_money_flow | jus_vn (+ bi_jus_vn.money_flow) |
| PlayerAddItem / ConsumeItem | etl_ingame_item_flow | jus_vn |
| OnlineRoleNum(ForSEA) | etl_ingame_ccu | jus_vn |
| ZpResult (gacha) | etl_ingame_zpresult | bi_jus_vn |
| CommonCalcLevelAndWinPoint (PVP) | etl_ingame_commoncalclevelandwinpoint | bi_jus_vn |
| TreasureUnlock (weekly/PVE proxy) | etl_ingame_treasureunlock | bi_jus_vn |
| GetAchieve (OW proxy) | etl_ingame_getachieve | bi_jus_vn |
| RiKe (daily mission) | etl_ingame_rike | bi_jus_vn |
| ScoreBoostRiseBigRank / SetSubRankCert | etl_ingame_scoreboost* | bi_jus_vn |
| ConsumeLiveHuoLi (stamina) | etl_ingame_huoli | bi_jus_vn |
| Upgrade / UpgradeEquip | etl_ingame_upgrade(equip) | bi_jus_vn |
| NpcIM_SendGift / _Talk / _Tour | etl_ingame_npcim_* | bi_jus_vn (tour also in jus_vn std) |
| NPCIMChat / FuXiNpcPlayerSay / PlayerSendGiftToFuXiNpc | etl_ingame_npcimchat / fuxinpcplayersay / playersendgifttofuxinpc | bi_jus_vn |
| Garden* (6 events) | etl_ingame_garden* | bi_jus_vn (crop also in jus_vn std) |
| FashionClothes_Change | etl_ingame_fashionclothes_change | bi_jus_vn |

**Extras in Trino beyond playbook inventory:** `bi_jus_vn` adds `entermap, leavemap, shopitembuy, trade`.
**In samples but no dedicated table:** `ClientCheatLog` (anti-cheat — not modeled).

### 2d. cube-dev consumption layer
JUS is modeled in `cube-dev/cube/model/cubes/jus/` (**23 cubes** + 1 view `views/jus/user_360.yml`): `mf_users, user_identity, user_devices, user_ips, user_roles, recharge, billing_detail, billing_lifetime, user_recharge_daily/monthly/rolling, active_daily, user_active_monthly, user_active_rolling, retention, new_user_retention, game_key_metrics, marketing_cost, user_gameplay_daily, etl_prop_flow, ordered_event_funnel, ordered_funnel_canonical, cs_ticket_detail`. Cubes consume mostly the `jus_vn` standard schema; a few read `bi_jus_vn` (gameplay/funnel).

---

## 3. metadata.gds.vng.vn dataProduct (OpenMetadata)

- **49 dataProducts** registered (= games), all `lifecycleStage: DEVELOPMENT`, auto-detected by a "Metadata Classification workflow". Asset count in each product's *description* string ("from N assets") is **stale** — the live linked-asset count comes from the search API (jus_vn description says 7, actually links 50).
- **API to list a dataProduct's assets** (the `/dataProduct/jus_vn/assets` UI tab): the search API with a `query_filter` term on `dataProducts.fullyQualifiedName` — NOT the `?fields=assets` entity route (that returns empty):
  ```
  GET /api/v1/search/query?q=&index=all&from=0&size=100
      &query_filter={"query":{"bool":{"must":[{"term":{"dataProducts.fullyQualifiedName":"jus_vn"}}]}}}
  Authorization: Bearer <keycloak token>
  ```
- **jus_vn dataProduct = 50 assets**, spanning three serving layers + the source topic:
  - `trio-game.game_integration.jus_vn.*` — the standardized Trino core (etl/std/cons/mf/map) **IS cataloged & linked**.
  - `clickhouse.default.gds.jus_vn_*` — masterfile profiles, AppsFlyer, role_active (+ `_shard`/`_test` variants).
  - `kafka-gio.jus_vn-realtime` — the raw Kafka topic (one asset).
- **Real gap (corrected):** the `bi_jus_vn` gameplay-event tables (29) are **absent** from the dataProduct's 50 assets — only the standardized `jus_vn` schema is linked, not the per-event behavioral layer. (Earlier draft wrongly claimed the whole `game_integration` jus layer was un-indexed; that was an artifact of a weak `q=jus` ranking query.)

---

## 4. Synthesis — the 3 layers

| Layer | Where | What | Cataloged in portal? |
|---|---|---|---|
| Raw events (Kafka + daily file) | game logs | 30+ event types, playbook-documented | n/a |
| **Standardized core** | Trino `game_integration.jus_vn` (42) | etl/std/cons/mf/map — lifecycle, monetization, identity, marts | ✅ linked to dataProduct |
| **Gameplay detail** | Trino `game_integration.bi_jus_vn` (29) | per-event behavioral tables for segments | ❌ NOT linked (real gap) |
| Masterfile/serving | ClickHouse `default.gds.jus_vn_*` | masterfile profiles, AppsFlyer, CCU/billing views | ✅ linked |
| Source topic | `kafka-gio.jus_vn-realtime` | raw realtime Kafka topic | ✅ linked |
| Cube semantic | `cube-dev/.../cubes/jus/` | 24 cubes + user_360 view | n/a |

The playbook + samples describe the **raw layer**; Trino `game_integration` is the **standardized + gameplay layer** (1:1 complete vs playbook); the metadata portal currently only surfaces the **ClickHouse serving layer**.

---

## Appendix A — Full 49-dataProduct asset coverage (metadata portal)

Pulled via the search `query_filter` API (assets linked per dataProduct), 2026-06-16. `bi` = a `trio-game.game_integration.bi_<game>` gameplay schema is linked.

| dataProduct | assets | trino game_int | clickhouse | kafka topic | bi gameplay linked |
|---|--:|--:|--:|--:|:--:|
| ptg | 224 | 21 | 70 | 133 | ✅ |
| ballistar | 97 | 38 | 36 | 23 | — |
| kto | 95 | 81 | 14 | 0 | ✅ |
| cfm_vn | 72 | 58 | 14 | 0 | — |
| cros | 69 | 55 | 14 | 0 | ✅ |
| mts | 67 | 0 | 19 | 48 | — |
| tf | 60 | 46 | 14 | 0 | ✅ |
| **jus_vn** | **50** | **37** | **12** | **1** | **—** |
| mlb | 49 | 29 | 20 | 0 | ✅ |
| ballistar_vn | 48 | 34 | 12 | 2 | — |
| ktotw | 43 | 27 | 16 | 0 | ✅ |
| tlbb2 | 40 | 24 | 16 | 0 | ✅ |
| taydu | 39 | 19 | 16 | 4 | ✅ |
| muaw | 38 | 4 | 28 | 6 | — |
| bum | 31 | 15 | 16 | 0 | ✅ |
| topeleven | 31 | 10 | 20 | 1 | ✅ |
| dlr | 30 | 5 | 16 | 9 | — |
| gnoth | 30 | 0 | 30 | 0 | — |
| l2m | 30 | 4 | 26 | 0 | — |
| lan | 30 | 6 | 14 | 10 | — |
| vlcm | 28 | 28 | 0 | 0 | ✅ |
| skf | 26 | 4 | 22 | 0 | — |
| thiennu3 | 25 | 9 | 16 | 0 | ✅ |
| jx1m | 24 | 24 | 0 | 0 | ✅ |
| td | 24 | 8 | 16 | 0 | ✅ |
| jx2 | 23 | 23 | 0 | 0 | ✅ |
| wjx | 23 | 23 | 0 | 0 | ✅ |
| nrk | 22 | 4 | 18 | 0 | — |
| tlhj | 22 | 3 | 19 | 0 | — |
| tdbm | 21 | 5 | 16 | 0 | ✅ |
| tpg | 21 | 4 | 16 | 1 | — |
| gnovn | 20 | 0 | 20 | 0 | — |
| jx20 | 20 | 4 | 14 | 2 | — |
| csb | 17 | 0 | 14 | 3 | — |
| minigames | 17 | 0 | 9 | 8 | — |
| nikki | 17 | 17 | 0 | 0 | ✅ |
| dlmini | 16 | 4 | 12 | 0 | — |
| ttlcy | 16 | 0 | 16 | 0 | — |
| 3kf | 13 | 0 | 0 | 13 | — |
| ddtt / fsm / pk3qm / pubgm / sfni / ttllmini | 1 each | 1 | 0 | 0 | — |
| kvpv_mini / kvpv_mobile / pk3q / pwm_sea | 0 | 0 | 0 | 0 | — |

**Observations:**
- **Coverage is very uneven.** 4 products have **0** cataloged assets; 6 more have only **1** (incl. `pubgm` — which we model in cube-dev as `pubg`, yet the portal has 1 asset).
- **bi-gameplay layer is linked for ~17/49** games (cros, kto, tf, jx1m/jx2, mlb, ptg, vlcm, wjx, taydu, td, tdbm, thiennu3, tlbb2, ktotw, bum, nikki, topeleven). **jus_vn and cfm_vn are NOT** among them despite both having rich `bi_<game>` schemas in Trino — so the gap is not jus-specific.
- **cube-dev modeled games (ballistar, cfm, cros, jus, muaw, ptg, pubg, tf) portal coverage:** ballistar 97, cfm_vn 72, cros 69, jus_vn 50, ptg 224, tf 60 are well-cataloged; **muaw is thin (38, only 4 Trino tables)** and **pubgm is effectively absent (1)**.
- `ptg` is the only product with a large `kafka_topic` asset set (133) — others lean Trino+ClickHouse.

## Unresolved questions

1. **Two parallel JUS serving stacks** — Trino `game_integration.jus_vn` (our cubes) vs ClickHouse `default.gds.jus_vn_*` (portal/AppsFlyer). Which is the LiveOps source of truth, and are they reconciled? (CCU/billing exist in both.)
2. **Portal coverage gap** — should we ask data-platform to register `game_integration.jus_vn`/`bi_jus_vn` as the `jus_vn` dataProduct's output ports? Right now the 7 cataloged assets ≠ the tables we actually query.
3. **Scope of the standardization rollout** — only JUS has a folder. Is the LiveOps team planning the same playbook+samples per game (the other 48 dataProducts), and do we want our onboarding tooling to consume these folders?
4. **`jusn_vn_masterfile_role_profile`** (typo'd `jusn`) in ClickHouse — stray/duplicate? Worth flagging to data-platform.
5. Metadata token was short-lived (~30 min, expired ~12:06 GMT+7). For repeatable pulls we'd want the documented service API + a non-interactive token.
