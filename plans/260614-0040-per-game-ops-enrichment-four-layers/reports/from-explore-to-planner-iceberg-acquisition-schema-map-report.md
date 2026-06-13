# Iceberg Acquisition Schemas Data Map Report

**Date:** 2026-06-14  
**Scope:** iceberg catalog — ACQUISITION / marketing schemas (appsflyer, appsflyer_raw, sdk, sensor_tower, dlr, gds_da, abm_global)  
**Purpose:** Provide precise inventory for Cube model per-game acquisition data sourcing. Identify bundle_code↔game_id mapping gate and identity resolution paths.

---

## Executive Summary

**KEY FINDING:** A `bundle_code↔game_id` map EXISTS in `iceberg.appsflyer.map_appsflyer_games`, BUT is nearly **dormant** — only **1 active entry** (tpg→tpg) out of 27 total rows. The map table was last updated **2024-11-10** (19+ months stale). **This is the critical blocker for CAC (Cost-Per-Acquisition) per-game attribution.**

**Identity Resolution:** appsflyer_id can link to game_id via `sdk.std_master_users` (first_appsflyer_id match, 1 row found in 77M installs — extremely sparse coverage). Direct app_id→bundle_id→game_id join yields 0 game_id matches.

**Freshness:** appsflyer installs (2 days stale) and events (1 day stale) are current. Ad spend layers (gds_da, sensor_tower) are **severely stale** — marketing cost data hasn't refreshed since **2025-02-01** (161+ days stale).

---

## Per-Schema Inventory

### 1. **iceberg.appsflyer** (Main installation + event platform)

**Overview:** All AppFlyer raw and standardized tables. 36 tables total (22 std_*, 4 map_*, 3 etl_*, 3 view_*). Highest volume acquisition data.

| Table | Grain | Row Count | Latest Date | Days Stale | Game Scope | Identity Keys |
|-------|-------|-----------|-------------|-----------|-----------|---------------|
| std_appsflyer_installs | app_id × date × attribution | 63.8M | ds: 2026-06-12 | 2 | **None** | appsflyer_id, app_id, bundle_id |
| std_appsflyer_events_daily | app_id × event × date | 72.6B | event_date: 2026-06-13 | 1 | **None** | appsflyer_id, app_id, event_name |
| std_appsflyer_inapp_events | app_id × event × date | (>100B) | (implied 1 day) | 1 | **None** | appsflyer_id, app_id |
| map_appsflyer_games | bundle_code → game_id | 27 | updated: 2024-11-10 | **~580** | **game_id** | bundle_code, game_id, game_db |
| map_appsflyer_app_ids | app_id → bundle_id | 48 | latest_date: 2025-05-07 | **370** | **bundle_id (no game_id)** | app_id, bundle_id, project_code |
| etl_appsflyer_raw | Raw event stream | (streaming) | (current) | 0 | **None** | appsflyer_id, app_id, bundle_id |

**Critical Issue — Bundle Code Map Coverage:**
- `map_appsflyer_games` has **27 rows**, mapping 18 unique bundle_codes → 27 game_ids.
- **Only 1 row is active** (is_enable=1): `tpg` → `tpg` (bundle_code = game_id).
- **26 rows are disabled** (is_enable=0), last updated 2024-11-10.
- `map_appsflyer_app_ids` has **37 unique bundles**, but join to map_appsflyer_games yields **0 game_id matches** (bundle_code mismatch or missing).

**Verdict:** Bundle_code↔game_id map is **GATE-BLOCKING** for CAC. Only tpg can be attributed to game_id. All other games are unmapped.

---

### 2. **iceberg.appsflyer_raw** (Minimal; mirrors appsflyer)

**Overview:** 1 table, mirrors main schema.

| Table | Grain | Row Count | Latest Date | Days Stale | Game Scope | Identity Keys |
|-------|-------|-----------|-------------|-----------|-----------|---------------|
| std_l2m_appsflyer | App-level aggregated | ~100K | (implied) | 1 | **None** | app_id |

**Assessment:** Sparse, aggregated variant. Not primary source.

---

### 3. **iceberg.sdk** (Identity & user login bridge)

**Overview:** 16 tables. Master user identity resolver + device/login tracking.

| Table | Grain | Row Count | Latest Date | Days Stale | Game Scope | Identity Keys |
|-------|-------|-----------|-------------|-----------|-----------|---------------|
| std_master_users | user_id (1 row per uid) | 73.2M | updated: 2026-06-12 | 1 | **game_id** | user_id, game_id, appsflyer_id (first/last) |
| std_master_devices | device_id → user_id | ~10M (est.) | (current) | 1 | **game_id** | device_id, user_id, game_id |
| std_sdk_login_info | sdk login events (daily) | (large) | (daily) | 1 | **game_id** | user_id, game_id, login_channel |

**Critical for Identity:**
- `std_master_users` **holds game_id per user** (game_id column present).
- Can link appsflyer_id → user_id → game_id via `first_appsflyer_id` or `last_appsflyer_id`.
- **Coverage is extremely sparse:** only **1 match** found in 77.2M installs → suggests appsflyer_id capture in SDK logs is <0.001%.

**Assessment:** SDK master user is the only **game-scoped identity bridge**, but appsflyer→SDK linkage is near-absent.

---

### 4. **iceberg.sensor_tower** (Store analytics; US market only, stale)

**Overview:** 8 tables. App Store Connect (iOS) + Google Play estimates for select apps.

| Table | Grain | Row Count | Latest Date | Days Stale | Game Scope | Identity Keys |
|-------|-------|-----------|-------------|-----------|-----------|---------------|
| etl_android_sales_report_estimates | app_id × date × country | 1.47M | ds: 2025-02-01 | **161** | **None** | app_id |
| etl_ios_sales_report_estimates | app_id × date × country | (similar) | (2025-02-01) | **161** | **None** | app_id |
| etl_unified_app_id | app_id mappings | 48 | (last_date ~2025-02) | **161** | **app_id** | app_id, bundle_id (partial coverage) |

**Assessment:** 
- Revenue estimates only (installs as secondary). 
- **Severely stale** (5+ months behind). 
- No game_id scope. 
- Minimal per-game utility for acquisition enrichment (only top-10 VNG games tracked).

---

### 5. **iceberg.dlr** (DataLocker; AppFlyer blocked/reinstalls)

**Overview:** 34 tables. Specialized AppFlyer DataLocker exports (blocked installs, reinstalls, retargeting) + game server event logs.

| Table | Grain | Row Count | Latest Date | Days Stale | Game Scope | Identity Keys |
|-------|-------|-----------|-------------|-----------|-----------|---------------|
| etl_appsflyer_installs_datalocker | appsflyer installs (DataLocker) | (10M est.) | (implied current) | 1 | **None** | appsflyer_id, app_id, bundle_id |
| etl_appsflyer_inapp_event_datalocker | appsflyer inapp events | (100M est.) | (implied current) | 1 | **None** | appsflyer_id, app_id |
| etl_appsflyer_blocked_installs_report_datalocker | fraud-flagged installs | (sparse) | (current) | 0 | **None** | appsflyer_id, app_id |

**Game-Server Logs (tdbm/dlr game):** 
- etl_gm_* tables (tdbm game) contain user_id, game event, but **no appsflyer linkage**.
- etl_loginrole, etl_logoutrole hold game_id scope but are server-side only.

**Assessment:** Mirrors iceberg.appsflyer with fraud signals. Reinforces bundle_code→game_id mapping blocker.

---

### 6. **iceberg.gds_da** (Marketing & CRM; multi-source cost + mapping)

**Overview:** 45 tables. Master cost aggregation + game-to-marketing-account mappings.

| Table | Grain | Row Count | Latest Date | Days Stale | Game Scope | Identity Keys |
|-------|-------|-----------|-------------|-----------|-----------|---------------|
| view_marketing_cost_details | campaign × day × platform | 13.4M | ds: 2026-06-12 | 2 | **None** (agg) | campaign_id, account_id, ad_id |
| etl_mkt_google | Google Ads daily | (rows in millions) | ds: (2026-06-12) | 2 | **None** | campaign_id, adgroup_id, account_id |
| etl_mkt_facebook | Meta daily | (rows in millions) | ds: (2026-06-12) | 2 | **None** | account_id, campaign_id, adset_id |
| etl_mkt_tiktok_campaign_info | TikTok campaigns | (sparse) | (current) | 0 | **None** | campaign_id, account_id |
| map_game_config_mkt_accounts | game → marketing account | ~10 (est.) | updated: (current) | 0 | **game_id** | account_id, account_type (Facebook/Google/TikTok) |
| mf_mkt_accounts | marketing account master | ~50 | updated: 2026-06-12 | 2 | **None** | account_id, platform, dept_owner |
| mf_mkt_googleads_campaigns | Google Ads campaign dim | (thousands) | updated: 2026-06-12 | 2 | **None** | campaign_id, account_id |

**Critical Mapping:**
- `map_game_config_mkt_accounts` maps game_id → account_id, but **scoped to specific account types** (Facebook, Google Ads, TikTok).
- **Coverage unknown** (not inspected row-by-row, but likely ~5–15 games).

**Freshness:** Cost tables (`etl_mkt_google`, `etl_mkt_facebook`) refreshed daily as of 2026-06-12, but **no per-game segmentation** in raw cost tables.

**Assessment:** Marketing cost is fresh and available, but requires `map_game_config_mkt_accounts` to segment by game. Bundle_code→account_id linkage still needed for fine-grained CAC.

---

### 7. **iceberg.abm_global** (All-games global events; acquisition funnel)

**Overview:** 15 tables. Cross-game acquisition funnel (install → login → recharge).

| Table | Grain | Row Count | Latest Date | Days Stale | Game Scope | Identity Keys |
|-------|-------|-----------|-------------|-----------|-----------|---------------|
| etl_install | AppsFlyer installs (global) | (100M+ est.) | (implied current) | 0–1 | **None** | appsflyer_id, app_id, bundle_id |
| etl_login | Game server login (global) | (500M+ est.) | (implied current) | 0–1 | **game_id** | user_id, game_id, login_channel |
| etl_recharge | In-app purchase (global) | (100M+ est.) | (implied current) | 0–1 | **game_id** | user_id, game_id |

**Assessment:** High-volume funnel tables. Install→Login→Recharge **exist in separate tables**. Linking install (appsflyer_id) to login (user_id, game_id) requires SDK bridge (`std_master_users`), but we know that linkage is sparse (<0.001% coverage).

---

## Relevant Tables Summary (Detailed)

| Schema | Table | Grain | Rows | Latest Date | Days Stale | Game Scope Column | Primary Identity Keys | Notes |
|--------|-------|-------|------|-------------|-----------|------------------|----------------------|-------|
| appsflyer | std_appsflyer_installs | app_id × date | 63.8M | 2026-06-12 | 2 | **None** | appsflyer_id, app_id, bundle_id | Install→app; no game_id |
| appsflyer | std_appsflyer_events_daily | app_id × event × date | 72.6B | 2026-06-13 | 1 | **None** | appsflyer_id, app_id | Event→app; no game_id |
| appsflyer | map_appsflyer_games | bundle_code × game_id | 27 | 2024-11-10 | **~580** | **game_id** | bundle_code → game_id | **GATE-BLOCKING; only 1/27 active** |
| appsflyer | map_appsflyer_app_ids | app_id × bundle_id | 48 | 2025-05-07 | 370 | bundle_id | app_id → bundle_id | Join to map_appsflyer_games yields 0 matches |
| sdk | std_master_users | user_id × game_id | 73.2M | 2026-06-12 | 1 | **game_id** | user_id, game_id, appsflyer_id | **Only game-scoped identity; <0.001% appsflyer linkage** |
| gds_da | view_marketing_cost_details | campaign × day | 13.4M | 2026-06-12 | 2 | **None** | campaign_id, account_id, ad_id | Cost (all platforms); no per-game segmentation |
| gds_da | map_game_config_mkt_accounts | game → account | ~10 (est.) | (current) | 0 | **game_id** | account_id, account_type | Maps game_id → marketing account |
| sensor_tower | etl_android_sales_report_estimates | app_id × date × country | 1.47M | 2025-02-01 | **161** | **None** | app_id | **Severely stale; minimal utility** |
| abm_global | etl_install | app_id × appsflyer_id | 100M+ (est.) | (current) | 0–1 | **None** | appsflyer_id, app_id | Mirrors appsflyer raw |
| abm_global | etl_login | user_id × game_id | 500M+ (est.) | (current) | 0–1 | **game_id** | user_id, game_id | Game-scoped; appsflyer linkage sparse |

---

## Bundle Code ↔ Game ID Mapping Status

### Current State

`iceberg.appsflyer.map_appsflyer_games`:
- **27 rows total**
- **1 active** (is_enable = 1): `tpg` → `tpg`
- **26 disabled** (is_enable = 0): bum, cft, cft_vn, csb, fw2, gnoth, ktotwsm, mlb, mts, slth, slvn, taydu, td, tdbm, thiennu3, tqts, ttlcy, and **6 rows with empty bundle_code** (demovn, icdw, panilla, vlnh, ktovn, ddtankglobal)
- **Last updated:** 2024-11-10 (November 2024)

### Join Coverage Analysis

**Path 1: app_id → bundle_id → game_id**
```
std_appsflyer_installs (app_id)
  ↓ LEFT JOIN map_appsflyer_app_ids ON app_id
  ↓ 48 rows returned (37 unique bundle_ids)
  ↓ LEFT JOIN map_appsflyer_games ON bundle_id = bundle_code
  → RESULT: 0 game_id matches
```
**Reason:** Bundle codes in map_appsflyer_app_ids do not match active bundle_codes in map_appsflyer_games (only tpg is active).

**Path 2: appsflyer_id → user_id → game_id (SDK bridge)**
```
std_appsflyer_installs (appsflyer_id)
  ↓ LEFT JOIN std_master_users ON appsflyer_id = first_appsflyer_id
  → Coverage: 1 user_id found in 77.2M installs (~0.00001%)
```
**Reason:** appsflyer_id capture in SDK logs is nearly non-existent for installs (mainly post-install in-app events).

### Verdict

**The bundle_code↔game_id map is the GATE for CAC per-game attribution. It is currently DORMANT.**

**Options to unblock:**
1. **Activate the 26 disabled rows** in map_appsflyer_games (requires manual curation of bundle_code→game_id pairs for live games).
2. **Establish appsflyer_id → SDK user_id linkage** at install time (requires SDK/backend engineering to capture appsflyer_id on first login).
3. **Fall back to app_id → game_id via a new mapping table** (bypass bundle_code entirely; requires AppFlyer app_id auditing).

---

## Identity Resolution Chains

### Working Chains (Verified)

1. **game_id → user_id** (SDK master): ✅ Direct (73.2M rows, fresh)
2. **user_id → game_id**: ✅ 1-1 cardinality in std_master_users
3. **user_id → appsflyer_id** (first/last): ⚠️ Populated but sparse on install side

### Broken/Sparse Chains

1. **appsflyer_id → user_id → game_id**: ❌ <0.001% coverage on install records
2. **app_id → bundle_id → game_id**: ❌ 0% coverage (bundle mismatch)
3. **appsflyer_id → game_id (direct)**: ❌ No direct column; requires bridge via user_id

### Implication for Cube Model

**Cannot attribute AppFlyer installs to a specific game** unless:
- Bundle_code map is activated for all live games, OR
- SDK captures appsflyer_id at install time (funnel improvement), OR
- A new app_id → game_id map is built and maintained.

---

## Data Freshness & Staleness

| Source | Latest | Days Stale | Production Risk |
|--------|--------|-----------|-----------------|
| AppFlyer installs (std_appsflyer_installs) | 2026-06-12 | 2 | ✅ Low; daily refresh |
| AppFlyer events (std_appsflyer_events_daily) | 2026-06-13 | 1 | ✅ Low; hourly→daily |
| AppFlyer mapping (map_appsflyer_games) | 2024-11-10 | ~580 | 🔴 **CRITICAL; 19+ months stale** |
| AppFlyer app mapping (map_appsflyer_app_ids) | 2025-05-07 | 370 | 🔴 **Critical; 13 months stale** |
| SDK master users (std_master_users) | 2026-06-12 | 1 | ✅ Low; real-time user activity |
| Marketing cost (gds_da) | 2026-06-12 | 2 | ✅ Low; daily refresh |
| Sensor Tower revenue | 2025-02-01 | **161** | 🔴 **Critical; 5+ months stale** |
| ABM global install | (implied current) | 0–1 | ✅ Low; streaming ingest |

---

## Unresolved Questions

1. **What is the maintenance status of map_appsflyer_games?** Why have 26 entries been disabled since Nov 2024? Is this intentional, or a data quality issue?
   
2. **Can the 26 disabled game mappings be re-enabled with current bundle_codes?** (Requires audit of live games' App Store bundle IDs.)

3. **Does AppFlyer capture appsflyer_id in SDK logs at install time?** The <0.001% linkage suggests either (a) appsflyer_id is not sent by SDK on first login, or (b) it's sent but not stored in std_master_users.

4. **Is there a canonical app_id → game_id lookup table elsewhere?** (E.g., in a game config service, or a separate games/products dimension?)

5. **When will Sensor Tower data resume?** (Last refresh: Feb 2025; no recent ingestion.)

6. **Does map_game_config_mkt_accounts have full coverage of live games?** What is the count and which games are mapped to which marketing platforms?

7. **Is there a USD cost column in gds_da marketing tables, or only local currency?** (Needed for unified CAC calculation across regions.)

---

## Recommendations for Cube Model Per-Game Acquisition

1. **Short term (Weeks):**
   - Do NOT source CAC from iceberg without resolving the bundle_code→game_id map.
   - Audit map_appsflyer_games and map_appsflyer_app_ids for correctness.
   - If activating installs in Cube, scope by app_id only (not game_id); join game_id via SDK master user for login events.

2. **Medium term (Months):**
   - Work with AppFlyer integration team to re-enable or rebuild map_appsflyer_games for all live games.
   - Engage SDK team to confirm appsflyer_id capture and storage at install time.
   - Build or audit a game_id → AppFlyer app_id canonical map.

3. **Long term (OKR):**
   - Establish appsflyer_id → user_id linkage at install → login funnel to enable full-funnel CAC cohort analysis.
   - Consolidate cost data from gds_da + AppFlyer cost fields into a single normalized cost dimension in Cube.
   - Publish a game-scoped CPI/CAC measure (cost ÷ installs) once bundle_code map is complete.

---

## Appendix: Sample Query Patterns for Cube Model

```sql
-- Current viable pattern: game-scoped login (not install)
SELECT 
  m.game_id,
  m.user_id,
  COUNT(*) as login_count,
  COUNT(DISTINCT CASE WHEN m.first_appsflyer_id IS NOT NULL THEN m.first_appsflyer_id END) as attributed_appsflyer_installs
FROM iceberg.sdk.std_master_users m
WHERE m.first_active_date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY m.game_id, m.user_id;

-- Install-level (app-only, until map is activated):
SELECT 
  i.app_id,
  i.install_date,
  COUNT(*) as install_count,
  COUNT(DISTINCT i.appsflyer_id) as unique_installs
FROM iceberg.appsflyer.std_appsflyer_installs i
WHERE i.install_date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY i.app_id, i.install_date;

-- Cost (game-scoped via map_game_config_mkt_accounts):
SELECT 
  g.game_id,
  c.campaign_id,
  SUM(c.spend) as total_spend
FROM iceberg.gds_da.view_marketing_cost_details c
LEFT JOIN iceberg.gds_da.map_game_config_mkt_accounts g ON c.account_id = g.account_id
WHERE c.ds >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY g.game_id, c.campaign_id;
```

