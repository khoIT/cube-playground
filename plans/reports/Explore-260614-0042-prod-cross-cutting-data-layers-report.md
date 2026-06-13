# Cube-Prod Cross-Cutting Data Layers Investigation

**Status:** READ-ONLY investigation completed  
**Date:** 2026-06-14  
**Scope:** Validate monetization, acquisition, identity, and CS-ticket modeling in prod for dev reuse  

---

## FINDINGS SUMMARY

Prod **DOES model 3 of 4 families** with validated SQL/joins/PKs ready for dev reuse:

| Family | Status | Reusability | Notes |
|--------|--------|-------------|-------|
| **Monetization/Payment** | ✅ Modeled | Reusable as-is | Both per-game + cross-cutting VGA layers; transaction & daily snapshot |
| **Acquisition/UA-cost** | ⚠️ Partial | Reusable with adaptation | Install/campaign attrs in mf_users; NO AppFlyer cost or media-cost cubes |
| **Identity + Behavior** | ✅ Modeled | Reusable as-is | VGA cross-cutting user master (76M platform users); game-scoped join patterns proven |
| **CS / Support Tickets** | ✅ Modeled | Reusable as-is | Cross-cutting cs_ticket_report + cs_customer bridge; user_id join tested |

**Per-game scoping in prod:** Prod uses **game-prefixed cube names** (e.g., `jus_vn__recharge`, `cfm_vn__mf_users`) + schema-per-game (e.g., `jus_vn.std_ingame_user_recharge_daily`). No game_id dimension — scoping is **table/schema isolation**.

---

## 1. MONETIZATION / PAYMENT ✅

### Per-Game Layer (Game-Scoped Cubes)

**Verdict:** Reusable as-is.

#### Transaction-Level Cube
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/jus_vn/recharge.yml`
- **Cube Name:** `jus_vn__recharge`
- **Source Table:** `jus_vn.etl_ingame_recharge`
- **Primary Key:** Composite: `(account_id, pay_time, transid, role_id, prepaid_detail_item_id)`
- **User Join Key:** `account_id` → `mf_users.user_id`
- **Grain:** One row per recharge transaction
- **Key Dimensions:**
  - `user_id` / `account_id` (NetEase URS account, numeric string)
  - `transaction_id` (transid)
  - `recharge_time`, `recharge_date` (pay_time/log_date)
  - `pay_channel`, `pay_method` (IAP vs web)
  - `product_id` (prepaid_detail_item_id, e.g. "300wenyu")
  - `currency`, `charged_value` (cash)
  - `country_code`, `os_platform`, `device_model`
  - `server_id`, `role_id`, `role_level`, `vip_level`
- **Key Measures:**
  - `revenue_vnd` (sum of cash, VND-filtered)
  - `paying_users_exact` (count_distinct account_id)
  - `arppu_vnd` (derived)
  - `arpt` (avg revenue per transaction)
- **Pre-Aggs:** Yes (refresh 5min, incremental per log_date)
- **Refresh:** Every 5 minutes
- **Game Coverage:** jus_vn, cfm_vn, cros, tf, ballistar_vn (similar structure)

#### Daily Snapshot Cube
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/jus_vn/user_recharge_daily.yml`
- **Cube Name:** `jus_vn__user_recharge_daily`
- **Source Table:** `jus_vn.std_ingame_user_recharge_daily`
- **Primary Key:** Composite: `(user_id, log_date)`
- **Grain:** One row per user per recharge day
- **Key Dimensions:**
  - `user_id`
  - `log_date` (time dimension)
  - `ingame_last_recharge_*` (prefix indicates most-recent value: vip_level, role_level, server_id, payment_channel, product_id, country_code, os_platform)
  - `ingame_total_recharge_*` (aggregates for the day: value_vnd, value_usd, transaction_id)
- **Key Measures:**
  - `revenue_vnd_total` (sum of ingame_total_recharge_value_vnd)
  - `txn_count_total` (sum of transaction count)
  - `paying_users` (count_distinct user_id)
- **Refresh:** Every 30 minutes
- **Design:** Pre-aggregated upstream (faster than scanning raw); optimized for user-scoped queries

#### Feature Store (Wide Profile)
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/jus_vn/mf_users.yml`
- **Cube Name:** `jus_vn__mf_users`
- **Source Table:** `jus_vn.mf_users`
- **Grain:** One row per user
- **Monetization Columns:**
  - `ltv_vnd` (ingame_total_recharge_value_vnd) — lifetime
  - `ltv_usd` (ingame_total_recharged_value_usd) — lifetime
  - `ltv_30d_vnd` (30-day rolling)
  - `ltv_30d_usd`
  - `ltv_iap_vnd`, `ltv_web_vnd` (channel breakdown)
  - `lifetime_txn_count`, `lifetime_txn_count_iap`, `lifetime_txn_count_web`
  - `txn_count_30d`
  - `max_vip_level`
  - `total_recharge_days`
  - `is_paying_user` (boolean: LTV > 0)
  - `is_paying_30d` (boolean: LTV30d > 0)
  - `payer_tier` (whale ≥10M / dolphin ≥1M / minnow >0 / non_payer)
- **Design:** Feature materialization — no need to join to recharge cube for basic cohort metrics

### Cross-Cutting Layer (VGA Platform)

**Verdict:** Reusable as-is.

#### Payment Lifetime History (User × Game)
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/vga_payment_history.yaml`
- **Cube Name:** `vga__payment_history`
- **Source Table:** `iceberg.billing.pmt_users_history`
- **Grain:** One row per (user × game)
- **Rows:** 18.3M
- **Primary Key:** `(user_id, product_code)` synthetic
- **User ID Space:** 82% numeric (= vga__provider.provider_id), 18% UUID/email (legacy games)
- **Game Join:** 
  - Direct: `product_code` → `vga__product_map.product_code` → `client_id`
  - Composite: `(user_id, vga_client_id)` → `(vga__provider.provider_id, client_id)` (avoids fan-out)
- **Key Dimensions:**
  - `user_id` (payment user ID, numeric subset)
  - `product_code` (game code)
  - `first_month`, `last_month` (YYYY-MM)
  - `first_time`, `last_time` (timestamp)
  - `order_number_first`, `order_number_last`
- **Key Measures:**
  - `total_transactions` (sum of total_trans lifetime)
  - `total_revenue_vnd` (sum of total_amt_vnd)
  - `total_revenue_usd` (sum of total_amt_usd)
  - `avg_revenue_per_payer_vnd` (ARPPU lifetime)
  - `distinct_payers` (count_distinct user_id)
- **Pre-Aggs:** Yes (by product_code, lifetime grain)
- **Refresh:** Every 1 day
- **Coverage:** All games with payment data (cross-cutting)

#### Payment Delivery (Real-Time Transactions)
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/vga_payment_delivery.yaml`
- **Cube Name:** `vga__payment_delivery`
- **Source Table:** `iceberg.billing.pmt_transaction_history` (inferred from VGA architecture; not fully read)
- **Design:** Real-time transaction grain (1 row per payment txn)
- **Note:** Details not read; exists as complement to vga_payment_history (lifetime vs txn-level split)

---

## 2. ACQUISITION / MARKETING COST ⚠️

### Verdict: Reusable with adaptation

**NOT modeled directly in prod.** The following attributes ARE available, but NO cross-cutting AppFlyer cost or media-cost cube exists:

#### Acquisition Attrs in mf_users (Feature Store)
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/jus_vn/mf_users.yml`
- **Available Columns:**
  - `gds_bundle_code` — MMP bundle attribution (unknown game↔bundle_code mapping in prod)
  - `install_date` (CAST from attributed timestamp)
  - `install_month`
  - `media_source` (MMP source)
  - `campaign_id` (MMP campaign)
  - `is_paid_install` (boolean: 1/0)
  - `is_fraud_install` (boolean: 1/0)
  - `appsflyer_id` (device-level attribution ID, one per install)
  - `country` (unified_first_country_code)
  - `os_platform` (unified_first_os_platform)
  - `first_login_date`, `first_login_month`, `first_login_country`, `first_login_channel`, `first_device_model`
- **Issue:** `gds_bundle_code` → game_id mapping is **missing in prod YAML** (known issue in dev memory)
- **Design:** Acquisition metrics are materialized per-game in mf_users; no cross-game bundle cost table

#### Register Events (Fine-Grain)
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/jus_vn/etl_register.yml`
- **Cube Name:** `jus_vn__etl_register`
- **Source Table:** `jus_vn.etl_ingame_register`
- **Grain:** Per-role first-character-create (~3.5M rows for jus_vn)
- **Dimensions:**
  - `user_id` / `account_id` (NetEase URS)
  - `role_id`, `role_name`, `role_class`
  - `register_time` (create_time)
  - `log_date` (partition column, REQUIRED filter)
  - `login_channel`, `os_platform`, `device_model`, `country_code`
  - `is_guest` (boolean)
- **Use Case:** Register-vs-install funnel, time-to-create per channel
- **Note:** Does NOT carry bundle_code or appsflyer_id (those live in mf_users, not per-event)
- **Refresh:** Every 30 minutes
- **Constraint:** queryRewrite enforces ≤31-day bound on log_date filter

### What's Missing for dev:
- **No prod bundle_code↔game_id mapping table** (you must create)
- **No cross-game media cost cube** (CAC, CPI data)
- **No cohort-scoped AppFlyer cost join** (would be: install_date + bundle_code → ARPU - CAC)

---

## 3. IDENTITY + BEHAVIOR ✅

### Verdict: Reusable as-is

#### VGA Cross-Cutting User Master
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/vga_user_master.yaml`
- **Cube Name:** `vga__user_master`
- **Source SQL:** `SELECT * FROM iceberg.vga.latest_vga_user WHERE __is_delete = 0`
- **Rows:** 76M users (excludes 5.6K deleted)
- **Grain:** One row per platform user
- **Primary Key:** `id` (raw vga_id, bigint, internal only; hashed as `vga_id_hash` 16-char hex for external)
- **Key Dimensions:**
  - `id` (PK, private)
  - `vga_id_hash` (hashed 16-char hex, public)
  - `identifier_id` (external/integration ID, PII-ish, internal-only)
  - **Geo:** `country_code`, `region_code`, `language_code`, `timezone`, `territory_type`
  - **Account Meta:** `status` (enum: None/InActive/Active/Blocked/Deactivated/Delete/Withdraw), `profile_type` (enum: Unknown/User/OA/Guest/Atomic)
  - **Person:** `gender` (enum: Undefined/Male/Female/Other), `avatar_id`, `frame_id`
  - **Security:** `temporary_lock_count` (signal for fraud risk)
  - **Consent:** `consent_mkt_status`, `consent_mkt_at`
  - **Time:** `created_at`, `last_modified_at`, `last_login_at`, `agreement_at` (all from Unix millis cast to timestamp)
- **Outgoing Joins:**
  - `vga__user_pii` (one-to-one): `id` = `vga_id`
  - `vga__social_profile` (one-to-many): `id` = `user_id`
  - `vga__provider` (one-to-many): `id` = `vga_id` (composite key, see game-scoping below)
  - `vga__tier_profile` (one-to-many): `id` XOR hash = tier profile_id
- **Measures:**
  - `total_users` (count, excludes deleted)
  - `users_with_country` (count_distinct, non-null + non-empty country)
  - `locked_users` (count_distinct, temporary_lock_count > 0)
- **Pre-Aggs:** Yes (by_demographics: country × status × gender × language × territory_type × created_month; registrations_daily_by_country; user_overview_rollup)
- **Refresh:** Every 1 day
- **PII Excluded:** display_name, username, first/last name, email, phone, DOB, image URL, e_id, p_id, agreement/consent details
- **Coverage:** All VNG platform users (cross-game)

#### VGA Provider (User × Game Mapping)
- **Path:** Inferred from vga_user_master joins; cube not fully read
- **Use:** Bridge vga_id (platform user) to game-scoped provider_id + game (client_id)
- **Key Join Pattern:** `(user_id, vga_client_id)` for composite (avoids fan-out)

#### Behavior (Device, IP, Login Channel)
- **User Devices:** Per-game cube `jus_vn__user_devices` (example path: `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/jus_vn/user_devices.yml`)
- **User IPs:** Per-game cube `jus_vn__user_ips` (similar structure)
- **Design:** Game-scoped, can join directly to mf_users on user_id
- **Note:** No VGA-level cross-cutting device/IP cube in read files; each game owns behavioral grain

### Game-Scoping Strategy in prod

**Method:** Cube-name prefix + schema isolation (no game_id dimension)

Example flow for jus_vn:
```
jus_vn__mf_users (game-prefixed cube)
  ↓ sql_table: jus_vn.mf_users (schema-per-game)
  ↓ user_id (NetEase URS account)
  ↓ joins to jus_vn__user_devices (same schema, same prefix)
```

For cross-game VGA cubes:
```
vga__user_master (unprefixed, platform-wide)
  ↓ source: iceberg.vga.latest_vga_user (VGA schema)
  ↓ vga_id (platform user)
  ↓ joins to vga__provider + vga__product_map to bind to (user_id, game)
```

**For dev:** You must filter mf_users per game at ingest time (no runtime game_id dimension). VGA cubes are already platform-wide; filtering happens via provider → product_code → game_id join.

---

## 4. CS / CUSTOMER SUPPORT ✅

### Verdict: Reusable as-is

#### CS Ticket Report (Cross-Cutting)
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/cs_ticket_report.yaml`
- **Cube Name:** `vga__cs_ticket_report`
- **Source SQL:** `SELECT * FROM iceberg.cs_ticket.cs_ticket_report WHERE ticket_status = 'New'` (filters to 1 row/ticket)
- **Rows:** ~12M (one row per unique ticket, filters out Carryforward/Reopen duplicates)
- **Grain:** One row per ticket
- **Primary Key:** `ticket_id` (number)
- **User Join Path:**
  - `customer_id` → `vga__cs_customer.customer_id` (many-to-one)
  - Then `vga__cs_customer` maps to VGA via `vga_client_id` (product_id translation)
- **Key Dimensions:**
  - `ticket_id`, `ticket_code`
  - `customer_id` (FK to vga_cs_customer)
  - **Resolution:** `is_active` (enum: Closed / Rejected / Active), `ticket_status` (always 'New' after filter)
  - **Game/Product:** `product_id`, `product_code`, `product_name` (game name)
  - **Classification:** `dept`, `pillar`, `ticket_type`, `ticket_category`, `ticket_source`, `source_group`, `service_type`, `form_group`, `form_name`
  - **User Context:** `country_code`, `staff_dept`, `vip_id` (ticket-scoped VIP level), `user_segments`
  - **Time:** `created_date`, `ticket_created_time`, `first_closed_time`, `last_closed_time`, `closed_date`, `report_month`, `closed_month`
- **Key Measures:**
  - `total_tickets` (count)
  - `closed_tickets` (count, is_active='Closed')
  - `rejected_tickets` (count, is_active='Rejected')
  - `active_tickets` (count, is_active='Active')
  - `resolution_rate` (closed / total, %)
  - `distinct_customers` (count_distinct customer_id, exact)
  - `distinct_customers_approx` (HLL, ~2% error)
  - `distinct_games` (count_distinct product_code)
  - `avg_resolution_time` (avg of resolution_time column, seconds)
  - `avg_time_to_first_closed` (avg time to first resolution)
  - `total_reopened` (sum of total_reopened_times)
  - `avg_ticket_rating` (avg user satisfaction score)
- **Pre-Aggs:** Yes (daily_resolution_by_game: product_name × dept × ticket_type × created_date/day)
- **Refresh:** Every 1 day
- **Coverage:** All games (product_code already in table)

#### CS Customer Bridge
- **Path:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/vga_cs_customer.yaml`
- **Cube Name:** `vga__cs_customer`
- **Source SQL:** Base table `iceberg.cs_ticket.customers_v2` + LEFT JOIN to `cs_map_product` (product_id → product_code) + LEFT JOIN to `vga_map_product` (product_code → vga client_id)
- **Rows:** 12.58M (one row per customer record, customer_id unique)
- **Grain:** One row per CS customer profile
- **Primary Key:** `customer_id` (number)
- **User Join Keys:**
  - `user_id` (VGA provider_id space, numeric subset; ~96% match account_id)
  - Composite join to `vga__provider`: `(user_id = provider_id) AND (vga_client_id = client_id)` (avoids fan-out)
- **Game Join:** 
  - `product_id` (CS internal) → `cs_map_product.product_code` → `vga_map_product.client_id` (vga_client_id)
  - Thence to `vga__product_map` for game metadata
- **Key Dimensions:**
  - `customer_id` (PK)
  - `user_id` (provider_id space, numeric subset)
  - `account_id` (~96% == user_id, same space)
  - `product_id` (CS internal product id)
  - `vga_product_code` (translated product code)
  - `vga_client_id` (VGA system client_id, bigint, for composite join)
  - `cs_product_alias` (game name in CS)
  - **Profile:** `gender`, `tier_id`, `vip_id_current`, `vip_id_max`, `country_login_id`
  - **Account:** `login_channel`, `login_info` (PII risk), `social_id` (PII risk), `is_published`, `is_deleted`
  - **Time:** `created_at`, `modified_at`
- **Measures:**
  - `total_customers` (count)
  - `distinct_users` (count_distinct user_id, exact)
  - `distinct_users_approx` (HLL)
  - `distinct_products` (count_distinct product_id)
  - `distinct_games_mapped` (count_distinct vga_product_code)
- **Pre-Aggs:** Yes (by_product: vga_product_code)
- **Refresh:** Every 1 day

### User ID Join Approach

**How to reach a game user from cs_ticket:**

```
cs_ticket_report.customer_id
  → vga__cs_customer.customer_id
    ├─ .user_id (provider_id space) + .vga_client_id (game)
    └─ → vga__provider (composite: user_id + client_id)
         └─ → game-scoped cube (e.g., jus_vn__mf_users)
              via mapping vga__provider.provider_id → jus_vn.user_id
```

**Challenge:** CS ticket user_id is in "provider_id space" (not vga_id). To map back to a game (e.g., jus_vn__mf_users.user_id), you need:
1. The vga_product_code / vga_client_id (derived from product_id → cs_map_product → vga_map_product)
2. The provider_id (= cs_customer.user_id)
3. A cross-game join table: (provider_id, game) → (game_user_id)

This join table does NOT exist in prod YAML; it lives in runtime VGA mappings or must be constructed.

---

## 5. PER-GAME SCOPING IN PROD

**Method:** Prefixed cube names + schema-per-game (NO runtime game_id dimension)

### Example: jus_vn

```
Cube Name:       jus_vn__recharge
Schema:          jus_vn
Table:           jus_vn.etl_ingame_recharge
Cube Prefix:     jus_vn__
Join Keys:       Direct (same schema)
Game Isolation:  Schema isolation (jus_vn.* cannot touch cfm_vn.*)
```

All jus_vn cubes:
- `jus_vn__mf_users`
- `jus_vn__recharge`
- `jus_vn__user_recharge_daily`
- `jus_vn__active_daily`
- `jus_vn__etl_register`, `jus_vn__etl_login`, `jus_vn__etl_logout`
- `jus_vn__user_roles`
- `jus_vn__user_devices`
- `jus_vn__user_ips`
- `jus_vn__user_active_monthly`
- `jus_vn__user_recharge_monthly`

### Cross-Cutting (VGA) Cubes

```
Cube Name:       vga__payment_history
Schema:          iceberg.billing (NOT vga schema, but VGA-owned table)
Table:           iceberg.billing.pmt_users_history
Cube Prefix:     vga__ (indicates platform-wide, not game-specific)
Game Binding:    Via product_code → vga__product_map → client_id
Join Strategy:   Composite (user_id, vga_client_id) to avoid fan-out
Game Isolation:  Via product_code filter (no schema isolation)
```

### Scoping Summary for Dev

| Layer | Isolation Method | Game Dimension | Filter Needed | Notes |
|-------|------------------|-----------------|---------------|-------|
| Per-Game (jus_vn, cfm_vn, etc.) | Schema prefix | None | Table name already game-scoped | Easier — schema isolation |
| VGA Cross-Cutting (vga__*) | Cube prefix + product mapping | product_code / client_id | Runtime filter on product_code | Harder — must filter at join |

For dev: You likely want per-game cubes (similar to prod) + VGA layers for cross-cutting. Use prefix naming (`game__cubename`) to avoid collisions.

---

## REUSABILITY MATRIX

| Family | Cube | Adaptation Needed | Why | Recommendation |
|--------|------|-------------------|-----|-----------------|
| **Monetization** | jus_vn__recharge | None | Transaction PK, user_id join, channels all present | Copy as-is, rename prefix to game |
| **Monetization** | jus_vn__user_recharge_daily | None | Snapshot design proven; just change prefix | Copy as-is |
| **Monetization** | jus_vn__mf_users (subset) | Minimal | Keep LTV*/txn*/payer_tier dims; drop SDK/register dims if not needed | Use feature store pattern |
| **Monetization** | vga__payment_history | None | Cross-game working; composite join pattern proven | Copy as-is if doing VGA layers |
| **Acquisition** | jus_vn__mf_users (subset) | **Major** | bundle_code↔game_id mapping missing in prod; copy install/campaign dims but need to build mapping table | Use dims as-is; create bundle_code mapping separately |
| **Acquisition** | jus_vn__etl_register | None | Register funnel cube works; no bundle data (lives in mf_users) | Copy as-is for funnel analysis |
| **Identity** | vga__user_master | None | 76M user base, game filtering via provider join; proven design | Copy as-is if building VGA layer |
| **Identity** | jus_vn__user_devices | None | Behavioral grain at game level | Copy per-game cubes as-is |
| **CS Tickets** | vga__cs_ticket_report | Minimal | Bridge to game requires vga__cs_customer + provider mapping | Copy main cube; build provider↔game bridge if not provided |
| **CS Tickets** | vga__cs_customer | Minimal | Same as above | Copy as-is; join logic must resolve user_id space |

---

## KEY TAKEAWAYS FOR DEV IMPLEMENTATION

### 1. **Monetization: Reuse Direct**
   - Copy `recharge` (transaction) and `user_recharge_daily` (snapshot) cube YAMLs verbatim.
   - Rename prefix: `jus_vn__` → `{game}__`.
   - Adapt table names: `jus_vn.etl_ingame_recharge` → `{game}.etl_ingame_recharge` (follow your schema naming).
   - Join keys remain identical (`account_id` or `user_id` to mf_users).

### 2. **Acquisition: Reuse Dims, Build Mapping**
   - Copy install/campaign/appsflyer/media_source dims from `mf_users.yml` verbatim.
   - **You must create:** A `bundle_code` → `{game}` mapping table (not in prod YAML; known gap).
   - Stub measure: `is_paid_install`, `is_fraud_install`, `paying_rate` all portable.
   - No CAC/CPI cube in prod; you may need to build or integrate external media cost data.

### 3. **Identity: Reuse VGA Layer**
   - Copy `vga__user_master` YAML as-is if you want cross-game user identity.
   - Else, per-game identity lives in each game's `mf_users` + `user_devices` + `user_ips` cubes.
   - Game-scoping in prod is **via schema + join**, not runtime game_id dimension.

### 4. **CS Tickets: Reuse Pattern, Resolve Provider Join**
   - Copy `vga__cs_ticket_report` and `vga__cs_customer` cubes as-is.
   - Adapt join logic: `user_id` (provider_id space) + `vga_client_id` (game) must resolve to game user_id.
   - **Missing in prod:** Runtime provider_id ↔ game_user_id mapping; you'll need to build or obtain from VGA integration layer.

---

## UNRESOLVED QUESTIONS

1. **Bundle Code Mapping:** Prod has `gds_bundle_code` in mf_users but no canonical bundle_code↔game_id mapping in any YAML. Where is this maintained in prod runtime? (Known gap; dev memory confirms.)

2. **Provider ID to Game User ID:** CS tickets carry user_id in provider_id space. How does prod resolve (provider_id, vga_client_id) → (game_name, game_user_id) at query time? Is there a cached lookup or runtime join in the VGA provider cube (not fully read)?

3. **CAC / Media Cost:** No cross-cutting media-cost cube in prod. Is this intentional (media cost external, not Trino), or on the roadmap?

4. **IP Geolocation (ip2location):** Search for `ip2location` in dev memory mentions it as cross-cutting; prod YAML has none. Is it sourced differently or deferred?

