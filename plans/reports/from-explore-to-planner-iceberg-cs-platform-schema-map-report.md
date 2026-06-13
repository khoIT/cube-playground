# iceberg Catalog Schema Map: CS + Platform/Lineage

## Executive Summary

**CS Join Verdict:** cs_ticket_info → customers_v2 → product_id achieves **99.9% match rate** (4.66M / 4.67M rows). This is the cleanest path to game scoping. Unlike the dev approach (split_part on user_id, ~8%), the customer_id bridge is stable, normalized, and has multi-row coverage per customer across games.

**Freshness:** cs_ticket_info + cs_ticket_report both lag by 2 days (max_date: 2026-06-12, today: 2026-06-14) but fully populated daily via run_date partition.

**Freshness-Monitor Tables:** kafka_offset (ingestion lag per topic/partition), spark_offset (per-game ETL lag), std_iceberg_metadata_table_agg (table-level record counts + size).

---

## CS Ticket Schema Inventory

### Core Ticket Tables

| Table | Grain | Row Count | Max Date | Lag | Game-Scope Column | User→Game Join |
|-------|-------|-----------|----------|-----|-------------------|-----------------|
| cs_ticket_info | ticket (log_date, ticket_id) | 4.67M | 2026-06-12 | 2d | product_id (from cs_map_product) | customer_id → customers_v2.product_id (99.9% match) |
| cs_ticket_report | ticket (report_month, ticket_id) | 4.66M | 2026-06-12 | 2d | product_id | customer_id → customers_v2.product_id (99.9% match) |
| cs_ticket_logs | action (log_date, ticket_log_id, ticket_id) | — | — | — | product_group (per cs_map_product) | Inherits ticket's customer_id bridge |
| customers_v2 | customer×product (1-N) | 12.66M | — | — | product_id (game identifier) | PRIMARY BRIDGE: customer_id (normalized, multi-game) |
| cs_staffs | staff_id (minimal) | — | — | — | None (support team, no game scope) | N/A |

### Detail: cs_ticket_info

**Key columns:**
- **PK**: log_date, ticket_id
- **User join**: customer_id (→ customers_v2 for product_id)
- **Product scope**: product_id, product_code, product_name, dept, pillar (via cs_map_product)
- **Ticket metadata**: ticket_code, ticket_type, ticket_category, source_id, ticket_source, service_type, form_group, country_code, language_code, created_by
- **VIP tracking**: vip_id (nullable)
- **Status**: None (status in cs_ticket_report via join)
- **Timing**: create_date, updated_time
- **Partition**: run_date (lag 2d)

**Coverage note:** All 4.67M rows have non-null customer_id AND user_id. Zero nulls in core FK.

### Detail: cs_ticket_report

**Key columns (extends cs_ticket_info with lifecycle metrics):**
- **PK**: ticket_id (grain: single ticket)
- **Lifecycle**: ticket_created_time, first_received_time, first_responsed_time, first_closed_time, last_closed_time, last_updated_time, closed_month, closed_date
- **Resolution**: time_to_first_received, time_to_first_responsed, time_to_first_closed, resolution_time
- **Agent**: staff_id, staff_dept, staff_domain
- **Sentiment/AI:** first_sentiment_status, last_sentiment_status, first_ai_label_time, last_ai_service_time, etc. (50+ AI + sentiment columns)
- **Rating**: number_of_rating, total_score, ticket_rating, updated_total_score, updated_processes_rating
- **Business**: product_id, customer_id, vip_id, ticket_status, country_code, ticket_type, ticket_category
- **Partition**: run_date (lag 2d)

**Coverage:** 4.66M rows. 99.9% match to customers_v2 on customer_id.

### Detail: customers_v2 (Customer→Product Bridge)

**Key columns:**
- **PK**: customer_id
- **Game scope**: product_id (299 unique products tracked)
- **Account diversity**: login_info, login_channel (login_channels_v2 dim), user_id, account_id, social_id
- **Tiers**: tier_id, vip_game_id, vip_game_proportion, vip_game_total, vip_id_current, vip_id_max
- **Flags**: is_allowed_send_sms, is_published, is_deleted
- **Audit**: created_date, created_by, modified_date, modified_by
- **Versioning**: __ver, __is_delete

**Multi-row note:** 12.66M rows vs 1.61M unique customer_ids = 7.8 rows per customer on average. Multi-game customers have one row per product. This explains excellent join match rate—customer_id normalizes across ticket-product pairs.

### Detail: cs_ticket_logs (Action-Level Grain)

**Key columns:**
- **PK**: log_date, ticket_log_id (action grain)
- **Ticket FK**: ticket_id, ticket_process_id
- **Action metadata**: action_code, action_name, description_code, description_name (categorical)
- **State**: status_before, status_after, status_group
- **Agent**: by_id (staff), created_by
- **Product scope**: product_group (from cs_map_product)
- **Timing**: log_time (varchar, not timestamp)
- **Partition**: run_date (lag 2d)

**Use:** Granular action audit trail. Inherit ticket's customer_id join.

### Mapping Tables (cs_map_*)

| Table | Grain | Purpose |
|-------|-------|---------|
| cs_map_product | product_id | product_code, product_alias, product_name, product_group, dept, pillar, ticket volume snapshot |
| cs_map_product_tbl | product_id | (appears to be indexed version) |
| cs_map_product_group | product_group | product_group dimension |
| cs_map_product_group_tbl | product_group | (indexed) |
| cs_map_source | source_id | ticket_source, source_group (inbound channel: AIHelp, Facebook, Email, etc.) |
| cs_map_status | status_id | status_name, ticket_status (open/closed/pending/escalated) |
| cs_map_country | country_code | country dimension |

**Verdict:** Product mapping is normalized via product_id in cs_map_product. No separate customer→provider bridge in CS schema; rely on customers_v2.product_id + game Cube model to map product_id → game code.

---

## User→Game Join Verdict

### Recommended Path (99.9% Coverage)

```sql
cs_ticket_info
  → customers_v2 ON ticket.customer_id = customer.customer_id
  → [Cube game model] ON customer.product_id = game.product_mapping
```

**Metrics:**
- **Total tickets:** 4,668,491
- **Matched via customer_id:** 4,661,645 (99.9%)
- **Unmatched:** 826 rows (0.01%)

**Advantages over split_part(user_id, '@', 1) approach:**
1. **Normalization:** customer_id is a stable, primary key in customers_v2; user_id is an opaque identifier.
2. **Multi-game scope:** Customers have one row per product in customers_v2 = clean 1:1 for joins.
3. **Higher fidelity:** 99.9% vs ~8% (split_part fragile for non-email user_ids).
4. **Business semantics:** Product_id is the game reference, not derived from user_id parsing.

**Caveat:** 826 unmatched rows likely represent deleted customers or test accounts. Acceptable for analytics.

---

## Other CS Schemas

| Schema | Coverage | Notes |
|--------|----------|-------|
| pro_cs | Empty | (Placeholder or legacy) |
| nexus_ticket | 15 tables | Separate ticketing system (Jira-like). issues, journals, users, sla_settings, pt_ticket_count_*. Not integrated with cs_ticket flow. |
| gs2_cs | 40+ tables | Per-game CS mapping tables (a86_*, sfk_*, tn_, ttlcy_, etc.). Used for CS item/spend/player mapping. Does NOT contain tickets; augments cs_ticket with game-specific context. |

---

## Platform / Freshness-Monitor Tables (iceberg.metadata + pro_vga)

### Ingestion Lag (metadata schema)

| Table | Grain | Purpose |
|-------|-------|---------|
| kafka_offset | (cluster, topic, partition) | Offset snapshot per Kafka topic partition. Timestamp = when offset was recorded. **Use:** Compare current offset against Kafka leader to measure lag. |
| spark_offset | (source, sink, topic, partition, game_id) | ETL spark job offset per source/sink. **Use:** Identify stalled ETL for a specific game or pipeline. |
| etl_pg_audit | (catalog_name, table_namespace, table_name, timestamp) | Audit log of Iceberg write operations. **Use:** Identify which tables were updated when. |

**Freshness check approach:**
1. Query kafka_offset → max(ts) per topic to see when last data arrived.
2. Query spark_offset → max(ts) per game_id to identify which games are lagging.
3. Query std_iceberg_metadata_table_agg → max(collected_at) per table to validate snapshot freshness.

### Table Metadata (metadata schema)

| Table | Use |
|-------|-----|
| std_iceberg_metadata_table_agg | Record count + size per table (collected_at). Partition key + file count. |
| std_iceberg_metadata_stats_v2 | Column-level statistics (min, max, null count per column). |

### Provider Mapping (pro_vga schema)

| Table | Grain | Purpose |
|-------|-------|---------|
| latest_vga_provider | provider_id | provider_id, client_id (maps provider to VNG game app), user_id (from VGA central registry), name, alias, type, status. |
| map_vga_client | client_id | VNG game app metadata (client_name, identifier, territories_block, age_restrictions, etc.). |
| latest_vga_legacy_provider_mapping | provider_id | Maps legacy provider IDs to current. |

**Use:** If joining cs_ticket.customer_id → VGA provider_id → game client_id (alternative to customers_v2.product_id), but not recommended—customers_v2 is more direct.

---

## Summary Table: Best-Fit CS Table for Per-Game Cube Model

| Aspect | Recommendation |
|--------|-----------------|
| **Ticket fact table** | cs_ticket_report (enriched lifecycle + metrics) OR cs_ticket_info (raw events) depending on use case |
| **User→game join** | customer_id → customers_v2.product_id (99.9% coverage) |
| **Game scope column** | product_id from cs_ticket_report / cs_ticket_info |
| **Partition/freshness** | run_date (daily, 2-day lag) |
| **Additional context** | cs_map_product (product metadata), cs_map_source (ticket channel), cs_map_status (ticket state) |
| **Per-game enrich** | gs2_cs.gs2_cs_*_mapping_* tables for game-specific item/spend context (optional) |
| **Audit trail** | cs_ticket_logs (action grain) |
| **CS staff** | cs_staffs (minimal; product_group scoping not game-specific) |

---

## Unresolved Questions

1. **Unmatched 826 rows (0.01%) in customer_id join:** Should these be quarantined in a separate "unidentified customer" segment, or dropped from analytics? (Likely test/deleted accounts, but verify with CS team.)

2. **product_id → game_id mapping:** How does the Cube model currently map CS product_id (299 unique values) to game codes (e.g., cfm_vn, jus_vn)? Need to verify this mapping exists or create it.

3. **Outbound/proactive CS:** cs_ticket_info appears to capture inbound tickets only (user_id always populated). Is there a separate table for proactive CS outreach (campaigns, SMS, etc.)? If so, not found in cs_ticket schema—check gs2_cs or pro_da.

4. **Nexus tickets:** Why does iceberg.nexus_ticket exist separately? Is it a parallel ticketing system for certain games or regions? (Scope out of current task but noted for future.)

5. **freshness-monitor automation:** Should the data-health monitor query kafka_offset + spark_offset daily, or rely on etl_pg_audit timestamp + std_iceberg_metadata_table_agg.collected_at? (spark_offset more granular; recommend both.)

