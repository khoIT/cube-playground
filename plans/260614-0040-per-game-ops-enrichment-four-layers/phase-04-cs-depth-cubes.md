# Phase 04 — CS Depth Cubes (support-ops)

## Context Links
- Bridge spec (input): `reports/bridge-spec-cfm-jus.md` (phase 1)
- Source report: `plans/reports/from-explore-to-planner-iceberg-cs-platform-schema-map-report.md`
- Existing raw reader (NOT a cube): `server/src/lakehouse/cs-ticket-reader.ts` — a Trino reader; these cubes ADD a
  modeled CS layer alongside it; reconcile (do not rebuild the reader).
- Source tables (iceberg): `cs_ticket.cs_ticket_info` (4.67M), `cs_ticket.cs_ticket_report` (4.66M, enriched),
  `cs_ticket.customers_v2` (12.66M, the bridge), `cs_ticket.cs_ticket_logs` (action), `cs_ticket.cs_rating_processes` (CSAT)

## Overview
- **Priority:** P1 — VIP routing + CSAT + support-volume-per-segment. Lands AFTER MVP monetization (incremental).
- **Status:** pending · **Depends on:** Phase 1.
- **Description:** Author a game-scoped `cs_ticket_detail` cube from `cs_ticket_report` (enriched lifecycle +
  resolution + VIP + sentiment) joined to the game via the **`customer_id → customers_v2.product_id` path (99.9%
  match)** — NOT the dev `split_part` ~8% approach. Action-trail (`cs_ticket_logs`) and CSAT (`cs_rating_processes`)
  cubes are DEFERRED unless a named Phase-7 consumer exists (red-team #15). Tag `[freshness: lagging]` (2-day lag).

## Key Insights
- **CS join is SOLVED by iceberg** (red-team #13, RESOLVED): `cs_ticket_info/report.customer_id → customers_v2.customer_id`,
  then `customers_v2.product_id → game`. The CS report measured **99.9%** (4,661,645 / 4,668,491; 826 unmatched).
  This REPLACES the dev `split_part(user_id,'@',1)` ~8% framing entirely.
- **CS product_id namespace ≠ billing product_code** (phase-1 probe): `customers_v2.product_id` uses `267` for cfm
  (vs billing's `A49`). The CS game-scope is `customer_id→customers_v2.product_id`, reconciled to game in phase 1 —
  do NOT reuse the billing product_code filter here.
- **`cs-ticket-reader.ts` is a raw Trino reader, NOT a cube** (red-team #13): correct label. The new cube COEXISTS
  with it (the reader powers existing Care surfaces). Add a reconciliation test (cube ticket count vs reader for a
  known customer) so they don't silently diverge; decide which surface reads which.
- **`customers_v2` is multi-row** (12.66M rows / 1.61M customers ≈ 7.8 rows each — one per product). The join must
  scope to the game's product_id to get one customer row per game (avoid fan-out).
- **`cs_ticket_report` is the enriched fact** (lifecycle times, resolution_time, ticket_status, vip_id, staff,
  sentiment, rating) — prefer it over `cs_ticket_info` for the detail cube. Dedup to ticket grain (PK ticket_id).
- CS lags 2 days (max_date 2026-06-12 vs today) → triage/historical OK, NOT live SLA alerting. Tag `[freshness: lagging]`.
- Staff-identity cols (`staff_id`, `by_id`, `created_by`) → `public:false` (red-team #11 PII deny-list).

## Requirements
- Functional: per game, `cs_ticket_detail` (ticket grain via cs_ticket_report; routing/VIP/resolution/CSAT
  dims+measures), joined via the 99.9% customer_id path. `unresolved_share` measure (count where bridge NULL — the
  ~0.01% + any game-specific gap). DEFER `cs_action_log` (cs_ticket_logs) + `cs_rating` (cs_rating_processes) unless a
  Phase-7 consumer is named.
- Non-functional: ticket cube deduped to 1 row/ticket; bridge scoped to game product_id (no customers_v2 fan-out).

## Architecture
- Data flow: `iceberg.cs_ticket.cs_ticket_report` → cube `sql:` (JOIN customers_v2 on customer_id, filter
  product_id = game's CS product_id) → join mf_users many_to_one on the resolved user_id → routing/vip/CSAT dims.
  Unresolved-share surfaced as a measure.
- **Game-scope is the customers_v2.product_id filter** (the customer_id bridge), NOT folder placement and NOT the
  billing product_code. 3-part iceberg refs (cross-catalog, proven).

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/cs_ticket_detail.yml`, `.../jus/cs_ticket_detail.yml`
- Read: CS schema-map report; `server/src/lakehouse/cs-ticket-reader.ts` (reconcile, do not rebuild)
- DEFERRED (do NOT create now unless consumer named): `*/cs_action_log.yml`, `*/cs_rating.yml`

## Implementation Steps
1. Lift phase-1 CS keys: the game's `customers_v2.product_id` (cfm = 267; jus = phase-1 resolved) + measured
   match-rate. Confirm dedup to ticket grain (PK ticket_id in cs_ticket_report).
2. `cs_ticket_detail.yml`: cube `sql:` joins cs_ticket_report → customers_v2 (customer_id, filter game product_id) →
   resolve user_id → join mf_users. Dims (ticket_id PK, vip_id, dept/pillar/ticket_type/category/source, country,
   created/closed/resolution times, ticket_status, sentiment). Measures (total/closed/active tickets, resolution_rate,
   avg_resolution_time, CSAT score where present, `unresolved_share`). `[freshness: lagging]`. Staff cols `public:false`.
3. DEFER cs_action_log + cs_rating cubes — note as follow-ups requiring a named consumer + (if large) pre-agg.
4. Reconciliation test: cube ticket count for a known customer vs `cs-ticket-reader.ts` output; document divergence + which
   surface reads which.
5. Compile (isolated — one bad YAML fails the whole game model) + per-game /meta verify; confirm bridge match-rate
   equals phase-1 and only the game's tickets return.

## Todo List
- [ ] cs_ticket_detail.yml (cfm, jus) via 99.9% customer_id→product_id path + unresolved_share + freshness:lagging
- [ ] Dedup to 1-row/ticket verified; customers_v2 scoped to game product_id (no fan-out)
- [ ] Staff-identity cols public:false
- [ ] Reconciliation test vs cs-ticket-reader.ts (coexist, no divergence)
- [ ] cs_action_log / cs_rating DEFERRED unless consumer named
- [ ] Compile (isolated) + per-game /meta verification

## Success Criteria
- `cs_ticket_detail` compiles per game, browsable, deduped to ticket grain, game-scoped via customers_v2.product_id.
- Match-rate ≈ 99.9% documented; `unresolved_share` exposed (no false full-coverage).
- Coexists with cs-ticket-reader.ts (reconciled, labeled correctly); tagged lagging; not in any live SLA alert.

## Risk Assessment
- **customers_v2 fan-out** (Med×High): multi-row per customer inflates ticket counts. Mitigate: scope join to game
  product_id; verify with GROUP BY ticket_id probe.
- **Divergence from cs-ticket-reader.ts** (Med×Med): two CS sources disagree. Mitigate: reconciliation test + documented ownership.
- **Outbound CS not logged** (Med×Med, open Q): cs_ticket is inbound-only. Mitigate: document; cube valid for inbound triage.
- **CS product_id confused with billing product_code** (Med×High): wrong game scope. Mitigate: phase-1 reconciles both namespaces.

## Security Considerations
- NO raw contact PII (login_info/social_id in customers_v2 are PII-risk) — keep `public: false`.
- Staff identity (staff_id/by_id/created_by) `public:false`. CSAT/handling-time aggregate only; vip_id is a tier, not PII.
