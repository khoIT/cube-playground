---
title: "Query Performance & Optimization Hub"
description: "Capture live Cube query latency/status/preagg-routing, surface slow & failed queries in an admin hub, and offer playbook+LLM remedies with a draft-rollup scaffolder."
status: done
priority: P2
effort: ~5d
branch: main
tags: [observability, cube, preagg, admin, telemetry, optimization]
created: 2026-06-16
completed: 2026-06-16
---

> **Implemented 2026-06-16.** All 6 phases shipped + the huashu UI gate.
> huashu pick: **base = Variant A (triage table)**. Variants in `visuals/`. Initial build used a Variant C master-detail panel; superseded per user direction to an **inline expandable row** — clicking a failure row expands a recommendation panel in place (verdict + best remedy + draft YAML + LLM affordance). The explicit **"Optimize" action button is deferred** until a real fix-activation flow exists (today the panel is advisory/read-only).
> 95 tests pass (53 new + 42 regression); tsc clean on all new files; code-review = production-ready (no critical/high). Review L1/L2 applied (server-surfaced `slowMs`; neutral Optimize-button border). M1 (slow rollup-backed empty-array → `miss`) kept — it is phase-03's specified "actionable case", not a deviation.

# Query Performance & Optimization Hub

## Problem (verified)
Per-user query-builder queries (`mf_users.user_id` + date range, optionally `ltv_30d_vnd` filter) are row-listings no rollup matches → Cube falls through to raw Trino → cold Trino 15s+ → proxy fetch-abort returns 504 read as "timeout". `/admin/preagg-runs` is green because it only watches pre-agg BUILD/seal health, not live query latency/status/routing. Failed/504 queries are invisible: `emitQueryRun` records only `status===200` (`cube-proxy.ts:43-44`). A 15s→30s proxy bump already shipped (`cube-proxy.ts:27`) — NOT re-done here; the hub is the durable fix.

## Locked decisions (do NOT reverse)
1. Full hub, phased: telemetry → monitoring UI → suggestion engine → playbooks → admin action.
2. Optimizable query action = scaffold a **draft rollup YAML** snippet (review/copy only — no auto-apply/PR).
3. Suggestions = optimization-playbook catalog match first → LLM fallback when no playbook fits.

## Phases
| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | Telemetry capture + `query_perf` table + migration + prune | done | [phase-01](phase-01-telemetry-capture-and-store.md) |
| 2 | Read API + monitoring UI (failures section + collapsed success list) | done | [phase-02](phase-02-read-api-and-monitoring-ui.md) |
| 3 | Pre-agg-hit classification + rollup-matchability (lambda-aware) | done | [phase-03](phase-03-classification-and-matchability.md) |
| 4 | Optimization-playbook catalog + matcher | done | [phase-04](phase-04-optimization-playbook-catalog.md) |
| 5 | Rollup-YAML scaffolder + admin action UI | done | [phase-05](phase-05-rollup-scaffolder-and-action-ui.md) |
| 6 | LLM fallback (on-demand, lane-gated, cost-capped) | done | [phase-06](phase-06-llm-fallback.md) |

## Dependency graph
- P1 → P2 (UI needs data + API). P1 → P3 (classifier reads captured fields).
- P3 → P4 (matcher keys off matchability verdict). P3 + P4 → P5 (scaffolder needs matchable shape; action UI surfaces playbook + YAML).
- P4 → P6 (LLM only fires when no playbook matches). P5 ∥ P6 share the action panel (P5 ships panel skeleton; P6 adds the LLM affordance — sequence P5 before P6).

## Cross-cutting invariants
- **PII gate (amended 2026-06-16 by explicit user decision):** the `query_shape` column + the `activity_events` spine stay names-only (`projectQueryShape`). The admin `query_perf` table ALSO stores the **verbatim query** (`query_full` — filter values, dateRange, any UID list) so an admin can reproduce a slow/failed query. This was a conscious reversal, accepted with the privacy trade-off in view; exposure is bounded by admin-only read routes + 30d retention. A `source` column captures the issuing surface via an explicit `x-cube-source` header (`query-builder` / `dashboard:<id>` / `segment:<id>:<tab>` / `chat:<sessionId>`), set by both client transports + chat-service; Referer fallback. App routes/ids, not PII. Shown as a "Used in" column on the row.
- **Hot-path safety:** capture is fire-and-forget off the proxy response path (mirror `recordActivity`, `activity-store.ts:195`). Capture ALL non-200s; sample 200s (P1 §sampling).
- **Routing proof = compiled SQL FROM clause, NOT `usedPreAggregations`** (lambda rollups report `[]` even when sealed partitions serve — lessons-learned.md:61,69-73). P3 combines signals.
- **Admin-gated:** every new route uses `requireRole('admin')` + `requireFeature('admin')` (preagg-runs.ts:28-29); UI behind `AdminHubRoute` (index.tsx:132-136).
- **Design tokens only** (design-guidelines.md); mirror preagg-runs-tab.tsx; tab in `buildAdminTabs` (index.tsx:38-59).
- **huashu UI gate (MANDATORY):** the new monitoring page (P2) and the optimize action panel (P5) are net-new important surfaces — design hi-fi HTML variants with the `huashu-design` skill and surface a design-direction question to the user (pick/mix) BEFORE writing React. Variants → `visuals/`. See phase-02 §UI Design Gate.

## Open questions
See bottom of phase-01 and phase-06.
