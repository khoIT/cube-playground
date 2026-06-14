---
title: Segment Metric-Movement Layer on Lakehouse Snapshots
description: >-
  Per-(segment, day) metric series over existing membership snapshots:
  definition history, 3 cohort lenses, query-time joins; materialization gated
status: in-progress
priority: P2
branch: main
tags:
  - segments
  - lakehouse
  - trino
  - experimentation
blockedBy: []
blocks:
  - 260610-1709-schema-per-game-membership-rollup
created: '2026-06-12T08:57:45.373Z'
createdBy: 'ck:plan'
source: skill
---

# Segment Metric-Movement Layer on Lakehouse Snapshots

## Overview

Build the metric-movement substrate for the experimentation loop on TOP of the already-shipped membership snapshot (`stag_iceberg.khoitn.segment_membership_daily`/`_delta`, nightly job, commit ac25dfc). Brainstorm (APPROVED): `plans/reports/brainstorm-260612-1554-segment-metric-movement-lakehouse-report.md`.

**Locked decisions:**
- Persist the non-recomputable (membership ✅ exists, definitions → Phase 4); JOIN immutable per-user daily marts at query time. Full member-info fanout REJECTED (uid×segment×metric×day ≈ 1.8B rows/yr/segment, zero information gain).
- Cohort lenses (current / entry-cohort / stayers+anchor) are query-time constructs over existing tables — no new snapshot tables for lenses.
- Server-side Trino before any Cube model (lenses = anchor-parameterized self-intersections Cube can't express); Cube enters only in gated Phase 7 over the aggregate.
- **UI showcase via huashu-design**: any phase shipping an important UI surface (Phase 5 trajectory panel, Phase 6 lens switcher/metric series) generates 2–3 HTML design variants with the `huashu-design` skill FIRST, user picks/mixes, then React — never straight-to-React on new visual surfaces.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Recon — prod snapshot verify](./phase-01-recon-prod-snapshot-verify.md) | Completed |
| 2 | [Mart eligibility matrix](./phase-02-mart-eligibility-matrix.md) | Completed |
| 3 | [Treatment contract (doc-only)](./phase-03-treatment-contract.md) | Completed |
| 4 | [Definition snapshot — segment_definition_daily](./phase-04-definition-snapshot-segment-definition-daily.md) | Completed |
| 5 | [Trajectory panel — size and entered-exited](./phase-05-trajectory-panel-size-and-entered-exited.md) | Completed |
| 6 | [Metric series — three-lens Trino endpoint and UI](./phase-06-metric-series-three-lens-trino-endpoint-and-ui.md) | Completed |
| 7 | [GATED materialization — segment_metric_daily aggregate](./phase-07-gated-materialization-segment-metric-daily-aggregate.md) | Completed |
| 8 | [DEFERRED — as-of-entry attributes on delta](./phase-08-deferred-as-of-entry-attributes-on-delta.md) | Pending |

Sequencing: 1, 2, 3, 4 independent (parallelizable). 5 needs 1 (snapshots landing). 6 needs 2 (eligibility matrix) + 5 (panel to extend). 7 gated on 6's latency evidence / 2's restatement findings. 8 deferred until experimentation names attributes.

## Dependencies

- **Blocks `260610-1709-schema-per-game-membership-rollup`** (not started): that plan's CubeStore-rollup serve-layer covers the same membership reads — its go/no-go now depends on this plan's Phase 5/6 query-time latency evidence and the Phase 7 gate. If Phase 7 fires with a Cube-serving need, execute 1709 phases 00–02 instead of duplicating a model here.
- Builds on `260610-1517-segment-membership-lakehouse-snapshot` (done): tables, writers, nightly job.
- External: data platform answer on mart immutability/retention (Phase 2, non-blocking); external team treatment sync-back (Phase 3 contract, out of build scope).

## Key risks

- Identity-namespace mismatches on membership⨝mart joins (cfm vopenid, jus dual-row history) — Phase 2 join-probes are mandatory gates for Phase 6 registry entries.
- Prod snapshot possibly not yet enabled → history accrues only from enable date; communicate forward-only semantics.
- Survivor bias in stayers lens — UI labeling is a hard requirement, never the headline number.
