---
phase: 8
title: "DEFERRED — as-of-entry attributes on delta"
status: pending
priority: P3
effort: "1d"
dependencies: [4, 6]
---

# Phase 8: DEFERRED — as-of-entry attributes on delta

## Overview
Enrich `entered` delta rows with 2–3 attributes frozen at entry time (candidates: VIP tier, lifetime spend, days-since-install — final pick is an open user decision). Enables "did we acquire higher-quality members over time" — the ONE analysis the query-time join cannot do, because it needs the attribute value *as of entry date*, and stock attributes in `mf_users` are current-state, not historical.

**Deferred: do not start until a concrete experimentation/readout need names the attributes.** This is the surviving sliver of the rejected full member-info fanout — keep it a sliver.

## Key Insights
- Only `entered` rows get attributes (one row per member per entry event) — NOT daily fanout. Storage stays proportional to churn, not membership.
- Sidecar table beats widening `_delta`: `segment_entry_attributes(snapshot_date, game_id, segment_id, uid, attr_key, attr_value)` — schema-stable as the attr list evolves, joins delta by (date, game, segment, uid).
- Attributes derivable from daily marts at entry date (e.g. cumulative spend through D) don't need this table at all — recomputable = join, not persist. Only truly current-state-overwritten attrs (mf_users tier fields) qualify. Re-check against the locked persistence principle before adding each attr.

## Requirements
- Functional: entry-attr write in nightly run after delta; reader endpoint or extension of metric-series for entry-cohort quality breakdowns.
- Non-functional: per-attr failure isolation; attr list registry-driven (same pattern as metric registry).

## Implementation Steps (sketch — refine when activated)
1. User picks attrs + confirms each is non-recomputable (current-state-overwritten).
2. DDL sidecar table; writer joins delta entered-set to attr source at snapshot date; DELETE slice → INSERT.
3. Wire post-delta in nightly job; heartbeat row.
4. Consumer: entry-cohort quality view (e.g. avg entry-tier by entry week).

## Success Criteria
- [ ] Activated only with named attrs + named consumer (otherwise stays deferred)
- [ ] Each persisted attr documented as non-recomputable
- [ ] Storage growth ∝ entries/day, verified

## Risk Assessment
- Scope creep back toward full fanout → the non-recomputable test is the hard gate; recomputable attr requests get answered with a query-time join instead.
