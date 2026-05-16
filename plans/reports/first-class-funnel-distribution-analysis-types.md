# First-Class Funnel & Distribution Analysis Types — Research

**Date:** 2026-05-16
**Author:** khoi
**Status:** Research / pre-plan
**Trigger:** Current `Analysis` tab nested inside Results feels out of place; product intent is for Distribution and Funnel to be first-class analysis modes (not "another view of a Cube query").

---

## TL;DR

Promote analysis type from a **sub-tab inside Results** to a **first-class tab identity**, modeled after ThinkingData's `Analytics` menu. Each tab declares `type = query | funnel | distribution | …`, and the left builder + center renderer swap per type. Shared chrome (top tab strip, time-range chip, save) stays.

This removes the current conceptual mismatch (`Results | Analysis | SQL | REST | GraphQL` mixes "rendered output", "derived insight", and "raw export" on one tab strip) and unlocks Retention / Flow / Attribution later without re-architecting.

---

## Reference Material

- **ThinkingData product docs (EN):** https://docs-v2.thinkingdata.cn/?version=latest&lan=en-US&code=analysis_menu&anchorId=
- **Internal — video walkthroughs (Feishu wiki):** https://thinkingdata.feishu.cn/wiki/YK7zwH8D0iUSBukegbdcQWBMnBb
- **Internal — cross-source table configuration (Feishu wiki):** https://thinkingdata.feishu.cn/wiki/WTaIwU1d3iYGpZkOp1Kc6XSJnfg

Screenshots reviewed (in chat): TD Analytics menu, TD Events Analysis builder, TD Funnel Analysis full screen.

---

## What ThinkingData Does (Pattern Extracted)

1. **Analytics menu** = grid of analysis types grouped `General` (Events, Funnel, Distribution, Retention, Interval, Flows, Composition, Attribution, SQL IDE) and `Scenarios` (Leaderboard, Heatmap). Each entry has an icon + label.
2. **Each type opens a dedicated workspace** with three regions:
   - **Header:** type icon + name + save/export/settings (right)
   - **Left builder panel:** schema is **per-type** — e.g. Funnel has `Analyze Uniques by user/session`, numbered step list, `Conversion Window`, `Hold Property Constant`, `All events meet`, `Group by`. None of these map to the generic measures+dimensions+filters Cube model.
   - **Center renderer:** purpose-built — Funnel = bar chart with conversion arrows + per-step conversion/churn table; Distribution = histogram + percentile table.
3. **Shared chrome:** time-range chip (`Last 7D`), `VS` (comparison), refresh/export/settings, save button — identical across all types.

Key insight: **the builder schema IS the analysis type.** Funnel's "step 1, step 2, …" is not expressible in a measures+dimensions UI without ruining clarity.

---

## Current State (Cube Playground)

- A top-level tab = a Cube query (`Query 1`, `Query 2`).
- Inside each query: `Results | Analysis | SQL | REST | GraphQL` tabs (`src/QueryBuilderV2/QueryBuilderInternals.tsx:148-172`).
- Analysis tab hosts three sub-modes via radio picker (`src/QueryBuilderV2/analysis/analysis-panel.tsx`):
  - `breakdown` — re-renders the query result grouped by a chosen dimension
  - `distribution` — buckets a chosen measure
  - `funnel` — placeholder/early implementation; uses `ordered-funnel-cube-template.md` schema convention
- All three currently piggyback on the Cube query that owns the tab. They cannot express their own query model.

### Conceptual mismatch

The `Results | Analysis | SQL | REST | GraphQL` strip mixes three categories:

| Category | Tabs | What it is |
|----------|------|------------|
| Rendered output | `Results` | The query's table render |
| Derived insight | `Analysis` | A different analysis layered on top |
| Raw export | `SQL`, `REST`, `GraphQL`, `JSON` | The same query in different code formats |

`Analysis` doesn't belong with raw exports; it's a different *intent*, not a different *view*.

---

## Proposed Architecture

### 1. Tab type discriminator

```ts
type TabType = 'query' | 'funnel' | 'distribution';
// Future: 'retention' | 'flow' | 'attribution' | 'interval' | 'composition'

interface TabState {
  id: string;
  title: string;
  type: TabType;
  config: QueryConfig | FunnelConfig | DistributionConfig;
}
```

Tab pill in the top strip gains a small type icon (mirrors TD's icon-per-type treatment). Title still user-editable.

### 2. Tab-type registry

```ts
interface TabTypeDef<C> {
  icon: ReactNode;
  label: string;
  category: 'general' | 'scenarios';
  defaultConfig: () => C;
  LeftBuilder: ComponentType<{ config: C; onChange: (c: C) => void }>;
  CenterRenderer: ComponentType<{ config: C; result: ExecutionResult }>;
  executor: (config: C, ctx: CubeContext) => Promise<ExecutionResult>;
  serialize: (config: C) => string;  // for save/share
}

const REGISTRY: Record<TabType, TabTypeDef<any>> = { … };
```

This keeps Funnel/Distribution code isolated from the generic Query path.

### 3. "New analysis" picker

Replace `+` in the tab strip with a popover showing TD-style grid:

```
┌─ General ─────────────────┬─ Scenarios ──────┐
│ ● Query     ▲ Funnel       │ (placeholders    │
│ ▦ Distribution             │  for later)      │
└────────────────────────────┴──────────────────┘
```

(Retention/Flow/Attribution slots greyed-out until implemented — signals roadmap to users.)

### 4. Per-type builders

**Query (existing):** keep current `QueryBuilderInternals` — measures, dimensions, filters, time, segments.

**Funnel:**
- `Analyze Uniques by` — Select: `user | session | <custom>` (depends on schema convention)
- Numbered step list (drag-reorder) — each step = an event-cube reference + optional per-step filter
- `Conversion Window` — duration input (e.g. `1 Day`, `15 Min`, `7 Day`)
- `All events meet` — global filter applied to every step
- `Group by` — optional dimension for cohort split
- Center: funnel bar chart + conversion/churn table (toggle, like TD's `Conversion | Churn`)

**Distribution:**
- `Distribute` — Select: a measure
- `Bucket by` — `Auto | Fixed width | Custom edges` + parameters
- `All events meet` — global filter
- `Group by` — optional dimension
- Center: histogram + percentile table (p50/p90/p99)

### 5. Execution model

Neither Funnel nor Distribution maps to a single Cube query.

**Phase 1 — client-side composition (recommended start):**
- Funnel: N parallel Cube queries (one per step) with cumulative cohort filter `user_id IN (results of step N-1)` and time-window constraint. Post-process client-side to compute conversion rates and (optionally) per-segment cohort splits.
- Distribution: one Cube query with computed bucket dimension via `case when measure between … then 'bucket_1' …` injected as a custom dimension; or fetch raw rows and bucket client-side for small result sets.

**Phase 2 — server executor (only if perf bites):**
- Thin Node/Python service that orchestrates the multi-step Cube calls server-side and streams a normalized result. Keeps client lean and enables caching.

**Decision criterion:** start Phase 1; migrate to Phase 2 only when a real funnel exceeds ~3-step latency targets.

### 6. SQL / REST / GraphQL inspector tabs

These only make sense for `query`-type tabs. For `funnel` and `distribution`:
- Replace with a single `Source` view that shows: the JSON of the analysis config + the N composed Cube query payloads it expands into.
- Keeps the "see what's running" affordance without pretending Funnel is a single Cube query.

### 7. What happens to today's `Analysis` sub-tab

Remove. Migration:
- `breakdown` mode → fold back into Query (it IS just measures + group-by; no new schema needed)
- `distribution` mode → graduate to first-class Distribution tab type
- `funnel` mode → graduate to first-class Funnel tab type

Existing saved queries with `analysis: 'funnel'` config: one-shot migration to create a new Funnel tab seeded from the old config.

---

## Schema Convention Question (Funnel-Eligibility)

Funnels need to know "what cubes represent events" and "what column is the actor id." Three options:

| Option | How | Pro | Con |
|--------|-----|-----|-----|
| **Convention** | Treat any cube with `(time dim) + (user_id-like dim)` as event-eligible | Zero schema change | Brittle, false positives |
| **`meta` annotation** | Cube schema authors add `meta: { eventType: true, actorDim: 'user_id' }` | Explicit, simple | Requires schema-side work |
| **Explicit registry** | Playground config file listing eligible cubes + actor dims | Centralized | Drifts from schema |

**Recommended:** `meta` annotation. Matches Cube's existing extensibility pattern and is the only option that survives schema rename.

Cross-cube funnels (event A in cube X, event B in cube Y) likely need TD-style "cross-source table" mapping — see the Feishu doc on cross-source table configuration for prior art. This is the harder problem and probably Phase 2.

---

## Tradeoffs

| Aspect | Win | Cost |
|--------|-----|------|
| UX clarity | Each type gets purpose-built builder; intent visible from the tab strip | Bigger surface area to learn |
| Scalability | Retention / Flow / Attribution plug into registry without re-architecting | More boilerplate per type |
| Storage | Saved tabs serialize as `{type, config}` — extensible | Migration needed for existing saves |
| Code complexity | Funnel/Distribution logic isolated from Query path | New executor + per-type renderer to maintain |
| Backend dependency | Phase 1 needs none | Phase 2 needs a small service |
| Schema dependency | None for Distribution; Funnel needs eligibility convention | Asks something of schema authors |

---

## Recommended Phasing

1. **Phase 0 — registry + tab-type plumbing.** Introduce `TabType` discriminator, registry, picker popover. Wire existing Query as the first registered type. No new analysis types yet. Migration script for existing saved tabs.
2. **Phase 1 — Distribution as first-class.** Simpler schema (one measure + buckets), no cross-cube concern. Validates the registry pattern end-to-end. Delete distribution mode from current Analysis sub-tab.
3. **Phase 2 — Funnel (single-cube).** Implement `meta` annotation convention. Limit to funnels within one cube initially. Delete funnel mode from current Analysis sub-tab.
4. **Phase 3 — Source tab for Funnel/Distribution.** Replaces SQL/REST/GraphQL inspectors for non-query types.
5. **Phase 4 — Cross-cube funnels.** Adopt TD's cross-source table approach. Requires backend executor (Phase 2 of execution model).
6. **Future — Retention, Flow, Attribution, Interval, Composition.** Each is a new registry entry; chrome stays unchanged.

---

## Files Likely Touched (Pre-Implementation Estimate)

- `src/QueryBuilderV2/QueryBuilderInternals.tsx` — remove Analysis sub-tab; thread `TabType` through
- `src/QueryBuilderV2/analysis/*` — delete after migration (breakdown folds into Query; distribution/funnel graduate)
- `src/QueryBuilderV2/context.tsx` (or equivalent) — extend tab state with `type` + `config` union
- `src/components/QueryTabs/QueryTabs.tsx` — type icon in tab pill; new-analysis picker popover replaces `+`
- **New:** `src/QueryBuilderV2/tab-types/registry.ts`
- **New:** `src/QueryBuilderV2/tab-types/funnel/{builder,renderer,executor}.tsx`
- **New:** `src/QueryBuilderV2/tab-types/distribution/{builder,renderer,executor}.tsx`
- `docs/ordered-funnel-cube-template.md` — already exists; extend with `meta` annotation convention

---

## Open Questions

1. **Backend executor:** Phase 1 client-side composition only, or invest in a small executor service up front? (Recommended: defer.)
2. **Tab type mutability:** fixed at creation, or convertible later (e.g. "convert this Query into a Distribution using measure X")?
3. **Schema convention for funnel-eligibility:** is the `meta` annotation acceptable to schema authors, or do we need an external registry?
4. **Save model:** does a Funnel tab persist as the same artifact type as a saved Query, or split storage by type? (Affects share-link URLs and the Saved Queries panel.)
5. **Multi-step "event A then event B within window":** can we always express this as N Cube queries + client cohort intersection, or does some shape require a custom SQL clause / Cube extension?
6. **VS / comparison mode** (visible in TD screenshots): in scope for v1 or deferred?
7. **Cross-source tables:** how much of TD's cross-source configuration model do we adopt verbatim vs. lean on Cube joins?
