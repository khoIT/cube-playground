# Iceberg Identity & Behavior Schema Map

**Scope:** Map IDENTITY + BEHAVIOR schemas in `iceberg` catalog for Cube model migration to source from central identity/behavior tables.

**Period:** 2026-06-14 | **Cutoff:** All row counts as of scan time

---

## Executive Summary

**Central Identity Chain:** `vga.latest_vga_user` (vga_id: 79.2M rows) → `vga.latest_vga_provider` (user_id: 36.3M) → `vga.latest_vga_client` (client_id: 135 apps) → `mdm.map_product_code` (product_code↔game_id: 1.2K mappings)

**Identity Namespace Bridges:**
- **VGA → GDS snowflake user_id:** `vga.std_latest_vga_user_info_v3` (game_id + game_user_id + vga_id; 183.2M rows) | `vga.std_latest_unified_pii` (vga_id + ingame_user_id + product_code; 843.2M rows)
- **VGA → External Social:** `vga.latest_vga_external_provider_mapping` (vga_user_id → social_id + channel; 574.5K rows)
- **VGA → Partner (3P):** `vga.latest_vga_partner_mapping` (vga_user_id → partner_user_id; 55K rows)

**Behavior/Lifecycle:** User registration, login, recharge, active-day tracking across per-game + central tables (gds_da, vnggames, pro_vga)

**PII Redaction:** Full name, phone, email, ID card, address, DOB, gender — concentrated in vga.std_latest_*_pii + social tables.

---

## Per-Schema Inventory

### **vga (Core Identity Graph)**

**Description:** VGA is the central identity platform bridging game accounts to providers (social logins, email, partner integrations). Tables are "latest" snapshots unless `_history` or `_snapshot` suffix.

| Table | Grain | Rows (M) | Freshness | Identity Key → GDS Bridge | PII Cols |
|-------|-------|----------|-----------|--------------------------|----------|
| `latest_vga_user` | One per vga_id | 79.2 | Real-time (versioned) | vga_id (bare ID, NOT snowflake user_id) | phone_number, first_name, last_name, email |
| `latest_vga_provider` | One per provider_id | 36.3 | Real-time | user_id (= vga_id); provider_id = login method | — |
| `latest_vga_client` | One per client_id | 0.135 | Static reference | client_id = app/product registered in VGA | — |
| `std_game_product_mapping` | One per (game_id, product_code) | 0.218 | Batch | game_id ↔ product_code (from mdm.map_product_code) | — |
| `std_latest_vga_user_info_v3` | One per (vga_id, game_id, client_id) | 183.2 | Batch | **vga_id + game_user_id → GDS snowflake user_id** | — |
| `std_latest_unified_pii` | One per (vga_id, game_id, product_code) | 843.2 | Batch | **vga_id + ingame_user_id → GDS snowflake** | phone, email, id_card_number, full_name, dob, address |
| `latest_vga_external_provider_mapping` | One per (provider_id, user_id, channel) | 0.575 | Real-time | **vga_user_id → social_id (FB, Zalo, etc.)** | — (social_id is pseudonym) |
| `latest_vga_partner_mapping` | One per (partner_id, partner_user_id) | 0.055 | Real-time | **vga_user_id ↔ partner_user_id (3P partner)** | partner_user_id (opaque) |
| `latest_vga_authorization` | One per auth session | Streaming | Real-time | user_id, client_id (FK) | — |
| `std_latest_vga_pii` | One per vga_id | — | Batch | vga_id (not a snowflake bridge) | **HEAVY PII:** full_name, phone, email, id_card, address, dob |
| `std_all_game_user_profile` | One per (game_id, user_id) | 400.6 | Batch | **game_id + user_id = GDS snowflake** | — |
| `std_all_game_role_profile` | One per (game_id, user_id, role_id) | — | Batch | **game_id + user_id = GDS snowflake** | — |
| `std_latest_encrypted_social_profile*` | Per social account | — | Batch | Encrypted; provider-scoped ID | **ENCRYPTED PII** |
| `pii_vga_profile` | — | — | — | — | **ENCRYPTED** |

**Key Insight:** `vga.latest_vga_user.id` (bare snowflake) bridges to game-scoped user_id via `std_latest_vga_user_info_v3.game_user_id`. NOT a 1:1 match; one vga_id can have multiple game accounts.

---

### **pro_vga (VGA Aggregate / Public View)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `std_master_vga` | One per vga_id | — | Batch | vga_id | — |
| `latest_vga_provider` | Mirrored from vga | 36.3M | Real-time | user_id = vga_id | — |
| `latest_vga_client_social_profile` | Per vga_id + social account | — | Real-time | vga_id + social_id bridge | — |
| `view_providers_active_daily` | Aggregated | — | Real-time | — | — |

---

### **vnggames (Multi-Game User Master)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `std_master_users` | One per (app_id, user_id) | 99.4 | Batch | **app_id + user_id = GDS snowflake** | — |
| `std_user_profile` | One per (game_id, user_id) | 1.17 | Batch | **game_id + user_id = GDS snowflake** | — |
| `std_user_login` | Event log; per login | — | Event stream | game_id + user_id | — |
| `club_tier_snapshot_daily` | One per club member per day | — | Daily | — | — |

**Key Insight:** `vnggames.std_master_users` and `std_user_profile` are direct snowflake ID tables (no prefix stripping needed); used for VNGGames ecosystem (multi-game portal).

---

### **gds_da (GDS Data Analytics; Marketing + Behavior)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `etl_user_profile` | One per (game_id, user_id) | 3.25 | Batch (daily) | **game_id + user_id = GDS snowflake** | device_id, appsflyer_id (pseudonyms) |
| `etl_sdk_login` | Login event; one per SDK login | 285.5 | Event stream (daily) | **game_id + user_id** | **IP, device_id, device_info, idfa, idfv, android_id** |
| `etl_server_event_tracking` | Game server event | 0.290 | Event stream (daily) | **game_id + user_id** | — |

**Key Insight:** SDK login table is the richest device/location event source; IP + device IDs are PII.

---

### **mdm (Master Data Management; Dimension Tables)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `map_product_code` | One per product_code | 1.23 | Batch | product_code ↔ game_id (foreign key) | — |
| `map_game_app_id` | One per (app_id, bundle_id, platform, region) | 0.469 | Batch | app_id ↔ game_id ↔ bundle_id | — |
| `map_appsflyer_accounts` | One per AppsFlyer account | — | Reference | — | — |
| `vga_login_channels` | Dimension | — | Static | client_id ↔ login method | — |

---

### **pii (Direct PII Storage)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `zing_account_info` | One per Zing account | — | Batch | — | **HEAVY: full_name, phone, email, national_id** |

---

### **passport (Auth Snapshots)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `snapshot_encrypted_pii_personal_profile` | — | — | Snapshot | — | **ENCRYPTED PII** |

---

### **social (Social Provider Data)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `fb_page_info` | Per Facebook page | — | Batch | — | Page-level only |
| `fb_post_detail` | Per Facebook post | — | Batch | — | — |
| `fb_subscribe_log` | Event log | — | Event stream | — | — |

---

### **cdp (Customer Data Platform)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `std_loe_ptg_role_profile` | Per user role (PTG game) | — | Batch | — | — |

---

### **centralization (Central Warehouse Aggregates)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `std_central_user_profile_test*` | Per user (test) | — | Batch | — | — |

---

### **games (Game Registry)**

| Table | Grain | Rows | Freshness | Identity Key → GDS Bridge | PII |
|-------|-------|------|-----------|--------------------------|-----|
| `std_game_mapping` | One per game | — | Reference | game_id ↔ product_code ↔ app_id | — |

---

## Identity-to-GDS Bridge Chain

```
┌─────────────────────────────────────────────────────────────────┐
│  CENTRAL VGA IDENTITY GRAPH                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  latest_vga_user.id (snowflake vga_id; 79.2M unique)           │
│          ↓                                                      │
│  latest_vga_provider.user_id (= vga_id; 36.3M unique)          │
│      ├─ provider_id (login method: email, Facebook, Zalo) │
│      └─ client_id (app / product registered in VGA)      │
│          ↓                                                      │
│  latest_vga_client (client_id; 135 apps total)                │
│      └─ client_name, identifier (e.g., "MUAW iOS")           │
│                                                                 │
│  ┌──────── BRIDGE TO GDS SNOWFLAKE ────────────────┐          │
│  │                                                  │          │
│  │ std_latest_vga_user_info_v3                      │          │
│  │   vga_id + game_id + client_id                   │          │
│  │   ↓ game_user_id (per-game in-game account ID)  │          │
│  │   = GDS snowflake user_id                        │          │
│  │   (183.2M rows; covers ~2–3 game accounts        │          │
│  │    per vga_id on average)                        │          │
│  │                                                  │          │
│  │ std_latest_unified_pii                           │          │
│  │   vga_id + ingame_user_id + product_code         │          │
│  │   ↓                                              │          │
│  │   = GDS snowflake user_id                        │          │
│  │   (843.2M rows; aggregation of all game+PII)     │          │
│  └──────────────────────────────────────────────────┘          │
│                                                                 │
│  latest_vga_external_provider_mapping                           │
│      vga_user_id → social_id (FB PSID, Zalo UID)              │
│      (574.5K rows; subset of vga_id with social links)        │
│                                                                 │
│  latest_vga_partner_mapping                                    │
│      vga_user_id → partner_user_id (3P partner ID)            │
│      (55K rows; subset with partner accounts)                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  PER-GAME USER TABLES (Snowflake user_id directly)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  vga.std_all_game_user_profile (game_id + user_id; 400.6M)    │
│  vga.std_all_game_role_profile (game_id + user_id + role_id)  │
│  gds_da.etl_user_profile (game_id + user_id; 3.25M)           │
│  vnggames.std_user_profile (game_id + user_id; 1.17M)         │
│                                                                 │
│  → Direct snowflake user_id (no vga_id prefix needed)         │
│                                                                 │
│  BEHAVIOR/EVENTS:                                              │
│  ├─ gds_da.etl_sdk_login (285.5M login events)                │
│  ├─ gds_da.etl_server_event_tracking (290K server events)    │
│  └─ vnggames.std_user_login (event stream)                   │
│                                                                 │
│  IDENTITY ATTRIBUTES (rolling windows):                        │
│  └─ muaw.std_master_user_profile (per-game feature store)    │
│     [mirrors: country, install_date, media_source, cohort]   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  REFERENCE/MAPPING TABLES                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  mdm.map_product_code (1.23K rows)                             │
│    product_code ↔ game_id ↔ gds_bundle_code                   │
│                                                                 │
│  mdm.map_game_app_id (469 rows)                                │
│    app_id ↔ bundle_id ↔ game_id ↔ region                      │
│                                                                 │
│  mdm.vga_login_channels                                        │
│    client_id ↔ login method (email, FB, Zalo, Apple, etc.)   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Critical Identity Namespace Findings

### 1. **VGA ID is NOT a Snowflake User ID**
- `vga.latest_vga_user.id` is a 64-bit snowflake ID generated by VGA auth service
- **Does NOT directly equal** the user_id in game-scoped tables (e.g., `std_all_game_user_profile.user_id`)
- **Bridge required:** Use `vga.std_latest_vga_user_info_v3` with explicit game_id lookup

### 2. **Per-Game User IDs are Snowflakes**
- `gds_da.etl_user_profile.user_id` = snowflake (same scale as Cube mf_users)
- `vnggames.std_user_profile.user_id` = snowflake (app-scoped but snowflake granularity)
- `vga.std_all_game_user_profile.user_id` = snowflake (same as etl_user_profile)
- **These are the "true" GDS user_id** for Cube models

### 3. **VGA-to-Snowflake Bridge is M:N**
- One vga_id can have 2–4 game accounts (multi-game players)
- One snowflake user_id should have exactly 1 row per game (but may re-register)
- **Implication:** `LEFT JOIN mf_users` on `(game_id, user_id)` — not on vga_id

### 4. **Provider/Social Links**
- `vga.latest_vga_external_provider_mapping` bridges vga_user_id → social_id
- **Grain:** One row per (vga_user, provider, channel) combo
- **Caveats:** 
  - Not all vga_id have social links (optional)
  - Facebook PSID can be app-specific → multi-game mashup risk
  - Zalo UID is global across all Zalo integrations

### 5. **Partner (3P) Links**
- `vga.latest_vga_partner_mapping` (55K rows)
- **Grain:** One per (partner_id, partner_user_id)
- **Bridge:** Opaque partner_user_id → no intrinsic meaning in game context

---

## Behavior/Lifecycle Key Tables

### User Registration & Installation
- **`gds_da.etl_user_profile`** (game_id, user_id): install_time, register_time, first_active_time, last_active_time, first_charge_time, last_charge_time, media_source, campaign_id

### Login Events
- **`gds_da.etl_sdk_login`** (game_id, user_id, ds): device_os, device_id, country_code, ipv4, advertising_id (idfa/idfv), channel, user_type
- **Row Count:** 285.5M rows (highest cardinality event table)
- **Grain:** One per SDK login; not aggregated

### Server Events
- **`gds_da.etl_server_event_tracking`** (game_id, user_id, ds): eventtype, timestamp
- **Grain:** Per in-game event (sparse; 290K rows suggest very recent/test data)

### User Lifecycle Snapshots
- **`vnggames.std_user_profile`**: Aggregates install → last_active → first/last_charge per user
- **`vnggames.std_master_users`** (app_id, user_id): Cross-game user fingerprint (appsflyer_id, device history, country history)

### In-Game Activity (Per-Game)
- **`vga.std_all_game_user_profile`** (game_id, user_id): Login channels, in-game purchase, churn signals
- **`vga.std_all_game_role_profile`** (game_id, user_id, role_id): Character progression, level, last_active_date, total revenue

---

## PII Redaction Checklist

### **HEAVY PII** (Do NOT expose in public Cube dimensions)
- `vga.latest_vga_user`: phone_number, first_name, last_name, email → set `public: false`
- `vga.std_latest_vga_pii`: **full_name, phone_number, email, id_card_number, permanent_address, dob, gender** → set `public: false`
- `vga.std_latest_unified_pii`: **full_name, phone_number, email, id_card_number, permanent_address, dob** → set `public: false`
- `vga.std_encrypted_social_profile*`: Encrypted; OK to query but encrypted payload
- `gds_da.etl_sdk_login`: **ip, device_id, idfa, idfv, android_id** → set `public: false`
- `pii.zing_account_info`: **full_name, phone, email, national_id** → set `public: false`

### **Pseudonyms / Safe-to-Expose**
- appsflyer_id, device_id (when only used for dedup, not reversal)
- social_id (PSID, Zalo UID) — platform-scoped, opaque
- partner_user_id — opaque, scoped to partner

---

## Table Freshness & Grain Summary

| Freshness | Tables |
|-----------|--------|
| **Real-time (streaming, versioned)** | vga.latest_vga_* (except history/snapshot) |
| **Real-time (event stream, daily batched)** | gds_da.etl_sdk_login, gds_da.etl_server_event_tracking, vnggames.std_user_login |
| **Batch (daily, ~24h lag)** | vga.std_*, gds_da.etl_user_profile, vnggames.std_master_users, gds_da.etl_user_profile |
| **Static reference** | mdm.map_product_code, mdm.map_game_app_id, games.std_game_mapping |

---

## Unresolved Questions

1. **VGA User Lifecycle Finality:** Does `vga.latest_vga_user.__is_delete` flag old/dormant vga_ids? If yes, should Cube models exclude deleted users or include as a cohort dimension?

2. **Partner ID Bridging:** What is the cardinality of `latest_vga_partner_mapping`? Does one partner_user_id map to one or multiple vga_id (account linking case)? If M:1, how to handle in Cube?

3. **Social ID Reuse:** Can a Facebook PSID be shared across multiple games in the same app family (e.g., different MUAW variants)? If yes, is there a "canonical" game_id for joins?

4. **Encrypted Social Profiles:** Are `std_encrypted_social_profile*` tables queryable by Trino, or are they encrypted at rest (Vault/KMS)? If encrypted at rest, Cube can't use them without decryption service.

5. **ETL SLA:** What is the documented SLA for `gds_da.etl_sdk_login` and `etl_user_profile`? Do they replay historical backfill or forward-only stream?

6. **CloudSQL / Replication Lag:** VGA tables are versioned; is there a known replication lag from VGA's primary to Trino iceberg? What is the max _version staleness?

---

## Recommendations for Cube Model Migration

1. **Use game-scoped snowflake user_id directly** from `gds_da.etl_user_profile` or `vga.std_all_game_user_profile` — do NOT route through vga_id.

2. **Dimension tables:** Use `mdm.map_product_code` and `mdm.map_game_app_id` as `_references` in Cube models to avoid embedding opaque foreign keys.

3. **PII safeguards:** Mark all phone, email, full_name, IP, device_id columns as `public: false` in Cube YAML.

4. **Behavioral dimensions:** Prefer `etl_sdk_login` over raw event tables for device/geo signals (one row per login, easier to aggregate).

5. **User lifecycle:** Anchor on `etl_user_profile` (game_id, user_id) and LEFT JOIN to `latest_vga_*` only if social/partner context is needed (avoid full join to limit fan-out).

6. **Slowly Changing Dimensions (SCD):** Note that `vga.latest_vga_*` tables overwrite history (`__ver`, `__is_delete` flags). If historical tracking is required, source from `vga.latest_vga_provider_history` or equivalent.

---

**Report Generated:** 2026-06-14 | **Prepared For:** Cube Model Migration (Per-Game Identity Enrichment)
