---
phase: 3
title: Treatment-events DDL contract proposal (doc-only)
status: completed
priority: P3
effort: 1h
dependencies: []
---

# Phase 3: Treatment-events DDL contract proposal (doc-only)

## Overview
Zero-code side artifact: a proposed Iceberg DDL + semantics doc for the external team's treatment sync-back, so their data lands into an agreed contract instead of an invented one. Input for khoitn's meeting with the external team.

## Key Insights
- Joinability requirements drive the schema: `uid` must be in the same identity namespace as `segment_membership_daily.uid`; `treated_at` must be a timestamp (not date) so exposure ordering vs entry date is unambiguous; `variant` enables holdout semantics later.
- Same catalog/schema as the membership tables keeps joins single-catalog: `stag_iceberg.khoitn.treatment_events`.

## Requirements
- Functional: DDL + column semantics + 3 example readout queries (treated vs untreated members of a segment).
- Non-functional: proposal only — NOT created in Trino this round; external team owns the write path.

## Related Code Files
- Create: `plans/260612-1554-segment-metric-movement-lakehouse/reports/treatment-events-contract-proposal.md`
- Reference: `server/src/lakehouse/segment-membership-ddl.sql` (partitioning conventions)

## Implementation Steps
1. Draft DDL: `treatment_events(event_date DATE, game_id VARCHAR, campaign_id VARCHAR, uid VARCHAR, variant VARCHAR, channel VARCHAR, treated_at TIMESTAMP(6), source VARCHAR)` partitioned `ARRAY['event_date','game_id']`, PARQUET — mirror membership table conventions.
2. Document column semantics + identity-namespace requirement per game (cite Phase 2 matrix once available; don't block on it).
3. Include 2–3 example joins: segment members treated vs not; entry-cohort × treatment; per-campaign reach.
4. List open items for the external team: campaign-id taxonomy, dedup policy (re-treats), delivery-failure rows, backfill expectations.

## Success Criteria
- [x] Proposal doc complete with DDL, semantics, example queries, open questions (reports/treatment-events-contract-proposal.md)
- [x] uid namespace requirement stated per game

## Risk Assessment
- External team may already have a schema — proposal framed as negotiable contract, requirements (namespace, timestamp, variant) are the non-negotiables, names/extra columns are not.
