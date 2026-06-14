---
title: Ops interactive chart artifacts + chat-service chart guarantee
description: ''
status: completed
priority: P2
branch: main
tags: []
blockedBy: []
blocks: []
created: '2026-06-14T10:00:54.357Z'
createdBy: 'ck:plan'
source: skill
---

# Ops interactive chart artifacts + chat-service chart guarantee

## Overview

Two related chart improvements, both anchored on chat-service's existing chart system.

**Feature 1 — Interactive chart artifacts on `/ops`.** The Ops Console Overview renders three
hand-rolled inline-SVG charts (`OpsLineTrend`, `OpsStackedTrend`) that are view-only. Replace them
with chat-service's full chart renderer (`AssistantChartSection` + `ChartSectionMenu` +
`ChartSectionDataTable`, recharts) so each chart gains: chart-type switching, a raw-data table view,
CSV export, axis/encoding picker — **plus** a per-chart "Open in Playground" deeplink to drill into
the underlying Cube query. (User decision 2026-06-14: full reuse + per-chart Playground link.)

**Feature 2 — Guarantee a chart on every query artifact.** Today `emit_query_artifact` always ships
a clickable query card but a chart is purely LLM-optional and silently degrades
(`emit-query-artifact.ts:156-169`). Harden at the software level: deterministic server-side fallback
that executes the query and derives a chart spec when the LLM omits one or its spec fails to build,
**plus** a prompt nudge so the model emits good charts proactively. (User decision: both — prompt +
server net.)

**Key facts (verified during scout):**
- `AssistantChartSection` is a pure presentational component (`artifact: ChartArtifact` prop), not
  coupled to chat SSE/message state → directly reusable on `/ops`. (`src/pages/Chat/components/assistant-chart-section.tsx:72`)
- FE `ChartSpec.type` already includes the render-only `'dual-axis'` type. (`src/api/chat-sse-client.ts:58-61`)
- FE deeplink builder `buildPlaygroundDeeplink` exists (`src/utils/playground-deeplink.ts:140`).
- chat-service already executes Cube `/load` inside `preview-cube-query.ts:128` → factor out for the
  fallback to fetch rows. `emit_query_artifact` currently does NOT execute the query (only builds a
  deeplink) — the fallback must execute it to obtain `data` rows (ChartSpec requires `data.min(1)`).
- recharts v2.12.7 is the standard lib; design tokens in `src/theme/tokens.css`.

**Out of scope this round:** changing the chat UI's chart behavior beyond the new fallback; adding new
chart types; reworking the Playground itself; pie/scatter defaults for ops (menu still offers them).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Reusable chart renderer + ops adapter](./phase-01-reusable-chart-renderer-ops-adapter.md) | Completed |
| 2 | [Ops Overview interactive charts + Playground deeplinks](./phase-02-ops-overview-interactive-charts-playground-deeplinks.md) | Completed |
| 3 | [Chat-service deterministic chart fallback](./phase-03-chat-service-deterministic-chart-fallback.md) | Completed |
| 4 | [Chat-service prompt enforcement + tests](./phase-04-chat-service-prompt-enforcement-tests.md) | Completed |
| 5 | [Verification + docs](./phase-05-verification-docs.md) | Completed |

## Dependencies

- No cross-plan blockers. Builds on the already-shipped `/ops` console (commit 690367e) and the
  already-shipped chat-service chart system.
- Phases 1→2 are sequential (adapter before wiring). Phases 3→4 are sequential (fallback before the
  prompt that references it). Phases 1-2 (frontend `/ops`) and 3-4 (chat-service) are independent of
  each other and could be implemented in parallel, but ship/verify sequentially to keep review gates
  clean.

## Risks

- **Reuse coupling:** `AssistantChartSection` imports `T`/`CHART` from `shell/theme` and several
  `Chat/components/*` helpers. Importing it onto `/ops` pulls those in — acceptable (same app bundle),
  but verify no Chat-only context hooks are referenced. Mitigation: it takes only an `artifact` prop;
  add an optional `headerAction` slot rather than forking the component.
- **Fallback latency:** executing the query inside `emit_query_artifact` adds one `/load` per
  chartless turn. Mitigation: reuse the cached `/load` path (`load-cache-adapter`) and only execute
  when a chart is missing/failed.
- **Dual-axis representation:** payers-vs-cash needs two measures on different scales. Represent as a
  wide spec the renderer's `preferDualAxis`/`toDualAxisSpec` path handles; confirm with a unit test.
- **No silent regression to chat:** the new optional `headerAction` prop and the fallback must not
  change existing chat chart rendering. Covered by existing chat chart tests + new ones.
