---
title: "Chat-Service Chart Rendering"
description: "emit_chart tool + chart field on emit_query_artifact + recharts-driven assistant chart section. Lets the LLM pick the right chart for tabular result data."
status: pending
priority: P1
effort: ~2-3d
branch: new_design
tags: [chat-service, charts, recharts, sse, mcp-tool]
created: 2026-05-24
slug: chat-chart-rendering
---

# Plan — Chat Chart Rendering

Goal: when the chat LLM is about to print a markdown table, it instead (or also) emits a `ChartSpec` that renders inline with recharts. Covers both standalone charts (`emit_chart`) and chart-attached-to-query-artifact (`emit_query_artifact.chart`).

## Context Links

- Trigger conversation: user's Web vs IAP table example (2026-05-24)
- Existing chart lib: `recharts` (used by `/build` viz, QueryBuilderV2, segments visuals)
- Tool registry pattern: `chat-service/src/tools/emit-query-artifact.ts`
- DB persistence pattern: `chat-service/src/db/chat-store.ts`

## Phases

| # | File | Title | Status |
|---|---|---|---|
| 01 | [phase-01-chart-tool-surface.md](./phase-01-chart-tool-surface.md) | ChartSpec types, `emit_chart` tool, artifact extension, recharts section, skill prompts | [ ] |

Single phase — surface is small enough that splitting into Backend/Frontend phases adds coordination cost without testability benefit. Tests sit alongside their implementation.

## Decisions Locked (2026-05-24)

| Item | Decision | Rationale |
|---|---|---|
| Chart library | **recharts** (reuse the dep) | Already shipped in /build, ~85 KB vs +700 KB for echarts. No treemap/sankey/heatmap loss for the v1 chart-type set. |
| Row cap | **Auto-truncate top-N (30)** + lump "Other" row | LLM doesn't lose a tool round-trip. Footer caption notes truncation. |
| Persistence | **Declarative `ChartSpec` only** in `chat_turns.charts_json`; recompile recharts props on hydration | ~500 B/row vs ~5 KB; forward-compat if we swap renderer. |
| Card layout when both `query_artifact` + `chart` present | **Inline chart below summary, same card** | One physical card per query — keeps the visual unit clean. |
| Deeplink `?chart=<type>` pre-selection | **Defer to follow-up** | /build's chart type selector isn't URL-driven today; building that is a separate change. |

## Chart-Type Catalogue

The LLM picks from this enum; chart-spec compiler maps each → recharts component.

| Type | recharts component | When to use |
|---|---|---|
| `bar` | `BarChart` | 1 categorical + 1 metric, short labels |
| `horizontal-bar` | `BarChart` + `layout="vertical"` | many categories OR long labels |
| `stacked-bar` | `BarChart` + multiple `<Bar stackId="a">` | category + metric + series (the Web/IAP example) |
| `line` | `LineChart` | time dim + metric (single series) |
| `multi-line` | `LineChart` + multiple `<Line>` | time dim + metric + series |
| `area` | `AreaChart` | cumulative / trend with shading |
| `pie` | `PieChart` + `<Pie>` | ≤8 categories, 1 metric, shares of whole |
| `donut` | `PieChart` + `<Pie innerRadius>` | same as pie, modern look |
| `scatter` | `ScatterChart` | 2 metrics correlation |

Treemap/sankey/heatmap intentionally excluded — recharts doesn't ship them and they're rare for the chat surface. Revisit if usage demands.

## Key Dependencies

None — single phase.

## Out of Scope (this PR)

- `?chart=<type>` URL param consumed by `/build` (deferred — separate change to /build's chart selector).
- Auto-suggesting charts client-side without LLM involvement (defeats the "LLM picks the right chart" goal).
- Sankey / treemap / heatmap chart types.
- Chart download as PNG/SVG (recharts supports it, but YAGNI for v1).
- LLM-generated chart titles via a separate summariser (the `emit_chart`/`emit_query_artifact` call already requires `title`).

## Constraints

- recharts only — no new chart lib.
- Cap row count to 30 + "Other" lump server-side. Reject specs that arrive with > 100 rows as malformed (Zod).
- Every ChartSpec must declare `encoding.category` AND `encoding.value`; `encoding.series` only required for `stacked-bar` / `multi-line`.
- Persisted spec lives in `chat_turns.charts_json` for standalone charts; embedded chart lives inside the artifact JSON.
- `tsc --noEmit` clean across `chat-service/` and root.
- Vitest only, mock `@anthropic-ai/claude-agent-sdk`.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| LLM picks wrong chart type (e.g., pie for time-series) | Skill-prompt rules table; Zod schema rejects `pie` when `encoding.category` matches a known time-dimension regex (`*Date|*At|granularity present`). |
| `stacked-bar` spec missing `series` | Zod discriminated union forces `series` on stacked variants. |
| 30-row cap hits a legitimate analytical chart | `truncated: true` flag in compiled output; footer caption "Showing top 30 of N — full data in /build". |
| Recharts SSR / hydration issues in tests | jsdom is fine for recharts; existing `ChartRenderer` tests pass under jsdom. |
| Bundle bloat from importing all recharts components in the chat path | Selective imports per chart type only when rendered. Lazy `React.lazy` on `assistant-chart-section.tsx` if measurable cost. |

## Success Criteria

1. LLM calls `emit_chart` standalone OR `emit_query_artifact({..., chart: ...})` → SSE event carries `ChartSpec` → frontend renders a recharts chart inline in the assistant message.
2. The Web vs IAP example renders as a stacked-bar (group → channel) with one tool call from the LLM.
3. Page reload hydrates the chart from `charts_json`.
4. All chat tests green (existing + new).
5. `chat-service` and root `tsc --noEmit` clean.
