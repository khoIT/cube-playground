# Phase 01 — Chart Tool Surface

## Context Links

- Plan overview: `./plan.md`
- Existing artifact tool: `chat-service/src/tools/emit-query-artifact.ts`
- Existing artifact card: `src/pages/Chat/components/query-artifact-card.tsx`
- Existing stream reducer (just fixed): `src/pages/Chat/hooks/use-chat-stream-reducer.ts`
- DB schema: `chat-service/src/db/schema.sql`

## Overview

- **Priority:** P1
- **Status:** pending
- **Description:** Add `emit_chart` tool (standalone) AND optional `chart` field on `emit_query_artifact` (embedded). Single shared declarative spec; single shared recharts renderer on the FE. Persist as spec only.

## Key Insights

- Existing `query_artifact` SSE pipeline (turn-handler → store → SSE → reducer → committed sections) is the template. We're cloning it for `chart` and extending it for the artifact case.
- The renderer doesn't need to reuse `src/QueryBuilderV2/components/ChartRenderer.tsx` — that file is coupled to QueryBuilder row shape. A purpose-built `assistant-chart-section.tsx` (~150 LOC) consuming the declarative spec is cleaner.
- Top-N truncation happens server-side in the chart-spec service, NOT in the LLM tool handler or in the FE. Single source of truth.
- The `CLEAR_STREAM_BUFFERS` action already lands in `use-chat-stream-reducer.ts` from the duplication fix — extend it to also clear `currentCharts`.

## Requirements

### Functional

1. **Tool `emit_chart`** — Zod-validates a `ChartSpec`, applies top-30 truncation, emits SSE `chart` event, persists into `chat_turns.charts_json`.
2. **`emit_query_artifact` extended** — optional `chart` field on input; when present, validated identically and stored alongside the artifact JSON.
3. **`ChartSpec` discriminated union** — variant per chart type, with the right `encoding` shape required by the renderer:
   - `bar` / `horizontal-bar` / `pie` / `donut` / `line` / `area` / `scatter` → `{ category, value }`
   - `stacked-bar` / `multi-line` → `{ category, value, series }` (series required)
4. **Renderer `assistant-chart-section.tsx`** — accepts compiled `ChartSpec`, renders a recharts chart fixed at 320 px height, with title + optional caption + truncation footer when `truncated`.
5. **Persistence + hydration** — `chat_turns.charts_json` round-trip; `QueryArtifact.chart` round-trip inside `artifacts_json`.
6. **Skill prompts updated** — explore, metric_explain, compare, diagnose: chart-type rules table + when to call.

### Non-functional

- Vitest unit tests for chart-spec validator, top-N truncation, tool handlers.
- vitest + RTL component test for `assistant-chart-section.tsx`.
- `tsc --noEmit` clean in `chat-service/` and root.
- No regressions in existing 25 chat tests.

## Architecture

```
LLM → emit_chart({ type, title, data, encoding, caption? })
        │
        ▼
chat-service/src/tools/emit-chart.ts
        │  1. Zod validate
        │  2. chartSpecService.truncateTopN(data, 30)
        │  3. ctx.sseEmitter.emit('chart', chartArtifact)
        │  4. return { ok: true, id }
        ▼
turn-handler appends → chat_turns.charts_json
        │
        ▼
SSE → FE chat-sse-client → useChatStream → CHART action
        │
        ▼
reducer.currentCharts: ChartArtifact[]
        │
        ▼
commit on DONE → AssistantSection { type: 'chart', artifact } in committedMessages
        │
        ▼
assistant-chart-section.tsx → recharts <BarChart|LineChart|...>
```

For embedded artifact-chart: same path, except the `chart` rides inside the existing `query_artifact` event payload and lands in `QueryArtifactCard`'s render output.

## Related Code Files

### CREATE

- `chat-service/src/services/chart-spec.ts` — `ChartSpec` Zod schema (discriminated union), `truncateTopN(rows, n)`, `pickChartType(shape)` helper (not LLM-facing, used in tests).
- `chat-service/src/tools/emit-chart.ts` — handler + tool registration metadata.
- `chat-service/test/chart-spec.test.ts` — validation + truncation tests.
- `chat-service/test/tool-emit-chart.test.ts` — handler tests with mocked SSE emitter.
- `src/pages/Chat/components/assistant-chart-section.tsx` — recharts renderer (≤200 LOC; if it grows, split per-type renderers into `chart-recipes/*.tsx`).
- `src/pages/Chat/components/__tests__/assistant-chart-section.test.tsx` — render + snapshot a stacked-bar.

### MODIFY

- `chat-service/src/types.ts` — add `ChartSpec`, `ChartArtifact`; extend `QueryArtifact` with `chart?: ChartArtifact`; extend `SseEvent` union with `{ type: 'chart'; data: ChartArtifact }`; extend `ChatTurnRow` with `charts_json: string | null`.
- `chat-service/src/tools/emit-query-artifact.ts` — accept optional `chart` Zod field; if present, run through chartSpecService; attach to artifact.
- `chat-service/src/tools/registry.ts` — register `emit_chart`.
- `chat-service/src/db/schema.sql` — `ALTER TABLE chat_turns ADD COLUMN charts_json TEXT`.
- `chat-service/src/db/migrate.ts` — idempotent column-add migration.
- `chat-service/src/db/chat-store.ts` — serialize/deserialize `charts_json`.
- `chat-service/src/api/turn-handler.ts` — listen for `chart` event, append to per-turn `charts[]` buffer, persist on turn end.
- `chat-service/.claude/skills/explore/SKILL.md` — append chart-rules section + when-to-emit.
- `chat-service/.claude/skills/metric_explain/SKILL.md` — same.
- `chat-service/.claude/skills/compare/SKILL.md` — same.
- `chat-service/.claude/skills/diagnose/SKILL.md` — same.
- `src/api/chat-sse-client.ts` — add `ChartArtifact` interface, `SseChart`, extend `QueryArtifact` with optional `chart`, add to `SseEvent` union.
- `src/pages/Chat/hooks/use-chat-stream-reducer.ts` — add `currentCharts: ChartArtifact[]` to state, `CHART` action, clear in `CLEAR_STREAM_BUFFERS`.
- `src/pages/Chat/hooks/use-chat-stream.ts` — handle `'chart'` SSE event → dispatch CHART; expose `currentCharts`.
- `src/pages/Chat/hooks/__tests__/use-chat-stream-reducer.test.ts` — extend regression test to cover `CHART` + `CLEAR_STREAM_BUFFERS` includes charts.
- `src/pages/Chat/chat-thread-page.tsx` — include standalone charts in committed sections; thread `currentCharts` through `buildStreamingSections()`.
- `src/shell/chat-overlay/use-panel-chat-state.ts` — same.
- `src/pages/Chat/components/assistant-message.tsx` — `AssistantSection` union grows `{ type: 'chart'; artifact: ChartArtifact }`.
- `src/pages/Chat/components/chat-message-list.tsx` — pass-through; no changes if `assistant-message` handles new type.
- `src/pages/Chat/components/query-artifact-card.tsx` — render embedded `<AssistantChartSection>` below summary when `artifact.chart` present.

### DELETE

None.

## Implementation Steps

### 1. Backend: ChartSpec schema + service

1. Create `chat-service/src/services/chart-spec.ts`:
   - Zod discriminated union on `type` field (9 chart types).
   - Each variant declares: `title: string`, `data: Array<Record<string, string | number>>` (max 100), `encoding: { category, value, series? }`, `caption?: string`.
   - For `stacked-bar` and `multi-line`, `series` is required (refine on the discriminated variant).
   - For `pie` / `donut`, `data.length ≤ 12` (refine).
   - `truncateTopN(rows, n=30, encoding)`: sort by `encoding.value` desc, keep top n-1, sum remainder as `{ [category]: 'Other', [value]: sumRest }`. Returns `{ data, truncated, originalLength }`.
2. Tests in `chat-service/test/chart-spec.test.ts`:
   - Valid pie/bar/stacked-bar/scatter shapes accepted.
   - Invalid: missing series on stacked-bar, > 100 rows, > 12 rows on pie.
   - Truncation: 50 rows → 30 (29 + "Other"), `truncated: true`, sum matches.
3. `tsc --noEmit && vitest run chart-spec.test.ts`. Pass.

### 2. Backend: `emit_chart` tool

1. Create `chat-service/src/tools/emit-chart.ts`:
   - `name: 'emit_chart'`, description: "Emit an inline chart when result data fits a chart shape. Use the chart-type rules in your skill body."
   - Input schema = `ChartSpec`.
   - Handler:
     - Validate (already done by Zod via SDK).
     - Apply `truncateTopN`.
     - Build `ChartArtifact = { id: uuid(), title, caption?, spec: truncatedSpec, truncated, artifactRef?: undefined }`.
     - `ctx.sseEmitter.emit('chart', chartArtifact)`.
     - Return `{ ok: true, id }`.
2. Register in `chat-service/src/tools/registry.ts`.
3. Tests `chat-service/test/tool-emit-chart.test.ts`:
   - Mock `sseEmitter`, assert event emitted with truncated data + `truncated: true` when data > 30.
   - Returns `{ ok: true, id }`.
4. `tsc --noEmit && vitest run tool-emit-chart.test.ts`. Pass.

### 3. Backend: extend `emit_query_artifact`

1. Add optional `chart: ChartSpec.optional()` to its input schema.
2. In handler, after building `artifact`, if `args.chart`:
   - Validate via same path (chart-spec service).
   - Apply truncateTopN.
   - Attach `artifact.chart = chartArtifact`.
3. Extend `chat-service/test/tool-emit-query-artifact.test.ts` (or add new file) with: artifact + chart roundtrip; missing series on stacked-bar rejects.

### 4. Backend: persistence

1. Add `charts_json TEXT` column to `chat_turns` in `schema.sql`.
2. In `migrate.ts`: `ALTER TABLE chat_turns ADD COLUMN charts_json TEXT` guarded by `PRAGMA table_info(chat_turns)` lookup.
3. In `chat-store.ts`: on turn write, serialize `charts: ChartArtifact[]` → JSON; on read, parse back.
4. Quick test: open a session, write a turn with charts, re-read, assert round-trip identity.

### 5. Backend: turn-handler wiring

1. In `api/turn-handler.ts`, where `query_artifact` events are buffered for persistence, add a parallel buffer for `chart` events.
2. On turn end (DONE), write `charts_json` alongside `artifacts_json`.
3. Forward `chart` SSE events to client unchanged.

### 6. Frontend: chat-sse-client types

1. Add `ChartArtifact`, `ChartSpec` interfaces (mirror chat-service types).
2. Extend `QueryArtifact` with `chart?: ChartArtifact`.
3. Add `SseChart = { type: 'chart'; data: ChartArtifact }` and include in `SseEvent` union.

### 7. Frontend: reducer + stream hook

1. `use-chat-stream-reducer.ts`:
   - State adds `currentCharts: ChartArtifact[]`.
   - Action `{ type: 'CHART'; artifact: ChartArtifact }` → append.
   - `CLEAR_STREAM_BUFFERS` also zeroes `currentCharts`.
   - `START` already resets via `makeInitialStreamState` — add `currentCharts: []` there.
2. `use-chat-stream.ts`:
   - Case `'chart'`: `dispatch({ type: 'CHART', artifact: event.data })`.
   - Return `currentCharts` from the hook.
3. Extend `use-chat-stream-reducer.test.ts` regression with: CHART action appends; CLEAR_STREAM_BUFFERS zeroes; START clears.

### 8. Frontend: AssistantSection + renderer

1. Extend `AssistantSection` in `assistant-message.tsx` with `{ type: 'chart'; artifact: ChartArtifact }`.
2. Create `assistant-chart-section.tsx`:
   - One function `renderChart(spec, theme)` switching on `spec.type`.
   - Use recharts primitives: `BarChart`, `LineChart`, `AreaChart`, `PieChart`, `ScatterChart`. `stacked-bar` = `BarChart` with multiple `<Bar stackId="a">`. `multi-line` = `LineChart` with multiple `<Line>`.
   - Series colour palette from `shell/theme.ts` (`T.brand400`, `T.success`, `T.warning`, `T.danger`, fallback grayscale).
   - Layout: title (`T.fSans`, 14 px, weight 600), chart 320 px, caption + truncation footer below.
   - `<ResponsiveContainer width="100%" height={320}>` wrapping the chart.
3. Component test `__tests__/assistant-chart-section.test.tsx`: render stacked-bar with 3 rows, assert title text + that recharts SVG mounts.

### 9. Frontend: page + panel commit logic

1. Both `chat-thread-page.tsx` and `use-panel-chat-state.ts` build sections from streaming buffers. Extend `buildStreamingSections()` to push `{ type: 'chart', artifact }` for each `currentCharts` entry, ordered between artifacts and text.
2. Ordering rule: reasoning → tool_calls → query_artifacts → charts → text. Charts after artifacts so the explanatory text lands last.

### 10. Frontend: artifact card embedded chart

1. In `query-artifact-card.tsx`, after the summary block, conditionally render `<AssistantChartSection artifact={artifact.chart}>` when present.
2. Compress the standalone chart's title styling when embedded (no separate title, since artifact card already has one — pass `embedded` prop).

### 11. Skill prompts

For each of explore/metric_explain/compare/diagnose, append a section:

```
## Charts

When you have ≥3 rows of tabular result data, prefer a chart over a markdown table.

- 1 categorical (≤8 vals) + 1 metric          → pie or donut
- 1 categorical (>8) + 1 metric, long labels  → horizontal-bar
- 1 time dim + 1 metric                       → line
- 1 time dim + 1 metric + 1 breakdown         → multi-line
- 1 categorical + 1 metric + 1 breakdown      → stacked-bar
- cumulative trend                            → area
- 2 metrics                                   → scatter

If the data backs a query artifact you're about to emit, pass `chart` to
emit_query_artifact instead of calling emit_chart separately — one card per
question is the rule.

Use emit_chart standalone when summarising LLM-derived rollups (groupings the
LLM built on top of raw query rows).
```

### 12. Manual smoke

1. Start chat-service + dev server. Ask "Show me payment channel revenue for May 2026".
2. Assistant should call `preview_cube_query` → `emit_query_artifact({ chart: { type: 'stacked-bar', ... } })`.
3. Card renders with inline stacked-bar.
4. Page reload — chart re-renders from `charts_json`.
5. Ask a follow-up that produces an LLM-rollup ("group those into Web vs IAP") → assistant calls `emit_chart` standalone.

## Todo List

- [ ] 1. chart-spec.ts + tests (validate + truncate)
- [ ] 2. emit-chart.ts tool + tests
- [ ] 3. extend emit-query-artifact + tests
- [ ] 4. DB column + migration + store round-trip
- [ ] 5. turn-handler chart event buffering
- [ ] 6. chat-sse-client types
- [ ] 7. reducer + stream hook + regression test
- [ ] 8. assistant-chart-section.tsx + component test
- [ ] 9. page + panel buildStreamingSections includes charts
- [ ] 10. query-artifact-card embedded chart
- [ ] 11. skill prompt updates ×4
- [ ] 12. manual smoke 5-step script

## Success Criteria

- All new + existing chat tests green (target: 32+ tests pass, 0 fail).
- `chat-service` + root `tsc --noEmit` clean.
- Manual smoke: stacked-bar artifact-chart renders inline; standalone `emit_chart` renders separate section; reload hydrates both.
- LLM Web-vs-IAP question produces one stacked-bar via `emit_query_artifact.chart` (not two cards) — proves skill prompt is internalised.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `T.success` / `T.warning` etc. may not exist on the shell theme | Read `shell/theme.ts` first; use whatever the palette exports. Fallback to a fixed 5-colour series. |
| Recharts `<ResponsiveContainer>` doesn't measure in jsdom | Test asserts SVG mount, not exact pixel dims. Existing recharts tests use the same trick. |
| Multiple `emit_chart` calls in one turn flood the UI | Skill prompt: "max 1 chart per turn unless explicitly comparing." No hard cap server-side. |
| `chat-store.ts` JSON parse fails on legacy rows (charts_json null) | Default to `[]` on null/undefined. |

## Security Considerations

- `ChartSpec.data` is LLM-generated; never embed into HTML strings. recharts components handle text via React props → safe by default.
- Truncation runs server-side — client never sees the un-truncated data, so a malicious LLM can't blow up the FE with a 10 k-row payload.

## Next Steps

- After this lands: consider `?chart=<type>` deeplink param so artifact cards open `/build` with the same chart type pre-selected.
- Consider auto-suggesting "Maybe this should be a chart?" hint on long markdown tables (post-stream FE detection) as a fallback if the LLM forgets to emit.

## Unresolved Questions

None at plan time. All bucket-A decisions captured in `plan.md` "Decisions Locked" table.
