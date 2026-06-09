# Chat Query Artifact — Table-first + LLM-picked 2-column chart + manual column picker

## Context

Chat emits a `query_artifact` card (`src/pages/Chat/components/query-artifact-card.tsx`) with an optional
inline chart (`ChartArtifact` → `ChartSpec`). Today the chart is fully LLM-authored: `data` rows + an
`encoding {category,value,series?}` + free-text column names. Observed problems for a multi-dimension
leaderboard query (`mf_users.ltv_total_vnd` + 5 dims, limit 100):

1. Chart shows a single bar series labelled **"revenue"** — not `ltv_total_vnd`, and semantically wrong
   (it's lifetime value, not period revenue). Label is LLM free text, not derived from `/meta`.
2. Chart represents only 1 measure; the 5 dimensions / depth are invisible before opening Playground.

## Decisions (locked with user)

- **Table-first** for leaderboard / multi-dim shapes — the card defaults to the data table (shows all columns).
- Chart uses the **≤50-row preview** (already the case); full data lives behind *Open in Playground*.
- **LLM picks the two most question-relevant columns** for a default chart (here `ltv_total_vnd` ×
  `days_since_last_active`) AND **picks the chart type** per question.
- Plus a **manual picker**: user can choose any two columns (X/Y, optional series) from the table to chart.
- Labels come from **Cube `/meta` title/shortTitle**, not LLM prose (fixes the "revenue" inconsistency).

## Contract hinge (verified)

`preview_cube_query` returns Cube `/load` rows keyed by member name (`mf_users.ltv_total_vnd`). The `explore`
skill tells the LLM to paste those rows verbatim into chart `data`. So row keys == cube members → backend
resolves a deterministic label/dataType/kind per column from `/meta`.

## New data: `ChartColumn` descriptor (additive)

```ts
interface ChartColumn {
  key: string;       // row key == cube member, e.g. "mf_users.ltv_total_vnd"
  label: string;     // meta shortTitle/title; fallback humanised key
  dataType: 'number' | 'string' | 'time';
  kind: 'measure' | 'dimension' | 'timeDimension';
}
// attached to ChartArtifact.columns?: ChartColumn[]
```

Drives: table headers, chart axis labels, and the picker's column list + numeric (Y) eligibility.

## Phases

### Phase 1 — Contract + deterministic labels  (fixes "revenue" mismatch)
- chat-service: add `resolveMemberMeta(meta, name) → {label, dataType, kind}` in
  `src/core/cube-meta-capability.ts`; build `columns[]` in `emit_query_artifact` from
  `Object.keys(chart.spec.data[0])` + meta; attach to `ChartArtifact`. Add `columns` to `ChartArtifactSchema`/type.
- frontend: mirror `ChartColumn` + `columns?` on `ChartArtifact` (`src/api/chat-sse-client.ts`); add
  `labelOf(columns,key)`; `ChartSectionDataTable` headers + axis labels use it (fallback to current humanise).
- Low risk, additive. Independently shippable.

### Phase 2 — Table-first default
- frontend `preferTableView(spec)` heuristic: table-first when category column is high-cardinality
  (rows > 12) OR column count ≥ 4. Apply as initial `view` in `query-artifact-card.tsx` and
  `assistant-chart-section.tsx`.
- explore skill: instruct LLM to paste ALL query columns into each chart `data` row (not just the 2 charted).

### Phase 3 — LLM picks 2 columns + chart type
- `explore/SKILL.md` (and compare/diagnose if they emit charts): for leaderboard/entity-dim artifacts,
  set `encoding` to the two most question-relevant columns and choose `type` via the existing routing table.
  Keep rows = full preview rows.

### Phase 4 — Manual X/Y/series picker
- Extend `ChartSectionMenu` with an "Axes" section: X (any column), Y (numeric columns only), optional Series —
  options sourced from `columns`. Emits `onChangeEncoding`.
- Thread `overrideEncoding` through `AssistantChartSection` (mirror existing `overrideType` flow) and the
  embedded card; `activeSpec` swaps `encoding`. Reuse existing re-encode helpers where possible.

### Phase 5 — Tests + docs
- chat-service: unit test `resolveMemberMeta` + `columns[]` builder (measure/dim/timeDim, fallback).
- frontend: `labelOf`/table headers; menu picker emits encoding; `preferTableView` heuristic.
- Add a `docs/lessons-learned.md` entry if any gotcha surfaces (chart data decoupled from query, keyed by member).

## Risk / notes
- Picker override lives in two render paths (embedded card + standalone section) — mirror the proven
  `overrideType` pattern to avoid divergence.
- No backend chart-data execution change — chart still uses preview rows the LLM pasted; only labels become
  deterministic. Data provenance (LLM-pasted vs executed) unchanged this round.

## Open questions
- Should `preferTableView` be backend-driven (a `defaultView` hint) instead of an FE heuristic? Defaulting to
  FE heuristic for KISS; revisit if it misfires.
