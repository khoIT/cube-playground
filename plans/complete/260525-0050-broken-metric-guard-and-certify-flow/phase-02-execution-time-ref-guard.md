---
title: "Execution-time ref guard (warn + override)"
status: complete
priority: P0
effort: "~2.5h"
---

# Phase 02 — Execution-time ref guard (warn + override)

## Context Links

- Validator: `server/src/services/metric-ref-validator.ts` — already exposes `validateRefs(metric, meta)` returning unresolved refs
- FE meta cache: `src/hooks/use-catalog-meta.ts` (or equivalent — single-flight `/meta` snapshot)
- Run sites:
  - `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/use-test-run.ts:235` (`cubejsApi.load(query as never)`)
  - `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-dimension-view.tsx:119`
  - `src/pages/Catalog/metric-detail/explore-query-builder.test.ts` (metric-detail run sites)
  - chat `chat-service/src/tools/preview-cube-query.ts` (also lives in `explain-cube-sql.ts`)

## Overview

Draft trust is a visual hint, not an enforcement. Today a user clicking "Run" on a broken metric still calls `cubeApi.load()` and gets a raw cube_api UserError. This phase introduces a thin pre-flight check at every business-metric execution site: validate refs against the cached `/meta` snapshot, surface a yellow inline banner naming the missing fields, and gate the actual network call behind an explicit "Run anyway" toggle that the user must flip per-metric per-session.

## Key Insights

- The validator already exists server-side; mirror its logic (or expose a tiny shared util) in FE. The "missing refs" check is just `refs - meta.cubes[].members.name`.
- **No modal.** The QB has flow state (filters, time range) that a modal would interrupt. Yellow inline strip above the Run button is the lowest-ceremony pattern that still demands explicit action.
- **Override state is per-(metric, session)**, NOT persisted. Reloads reset to "warn". Rationale: avoid a user clicking "always run" once and forgetting; broken metrics should keep being annoying.
- Chat tools (`preview_cube_query`, `explain_cube_sql`) cannot show a button — they return a structured warning payload and the LLM is responsible for asking the user "want to run anyway?" before retrying with `force: true`.

## Requirements

- F1. New hook `useMetricRunnability(metric, meta)` returns `{ status: 'ok'|'broken', missingRefs: string[] }`.
- F2. New component `MetricRunnabilityWarning` — yellow strip listing the missing refs and a "Run anyway" toggle button. Renders nothing when status is `ok`.
- F3. Wire into Step-6 Test Run, metric-detail Run, ColumnHealthRail/sample-row probes that originate from a business metric.
- F4. Chat: `preview_cube_query` and `explain_cube_sql` accept `force?: boolean`. When metric refs are broken AND `force !== true`, return `{ status: 'metric-draft', missingRefs }` instead of hitting Cube.
- F5. Override is session-scoped: `Map<metricId, true>` in a small Zustand slice (or `sessionStorage`). Cleared on reload.
- NF1. Pre-flight check is O(refs × cubes); skip it entirely when meta is not yet loaded (don't block on /meta).
- NF2. Bypass for query-builder ad-hoc queries that are not associated with a business metric — they remain unguarded (that's the playground use case).

## Architecture

```
                ┌─── meta (from useCatalogMeta) ───┐
                ▼                                  ▼
useMetricRunnability(metric)              validateRefs(metric, meta)
                │                                  │
                ▼                                  │
        { status, missingRefs } ◄──────────────────┘
                │
   status === 'broken' && !overrideMap[metric.id]
                │
                ├── render <MetricRunnabilityWarning /> (inline yellow, with "Run anyway" toggle)
                └── disable Run button / short-circuit cubeApi.load()
```

## Related Code Files

- Create: `src/pages/Catalog/metric-detail/use-metric-runnability.ts`
- Create: `src/shared/concept-shell/metric-runnability-warning.tsx`
- Create: `src/pages/Catalog/metrics-tab/metric-override-store.ts` — Zustand slice for session-scoped overrides
- Create: `src/lib/validate-metric-refs.ts` — shared FE port of `metric-ref-validator.ts` (≤60 LOC)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/use-test-run.ts`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-dimension-view.tsx`
- Modify: `src/pages/Catalog/metric-detail/*` (Run button host — confirm exact file in implementation)
- Modify: `chat-service/src/tools/preview-cube-query.ts`
- Modify: `chat-service/src/tools/explain-cube-sql.ts`

## Implementation Steps

1. Extract `validateRefs` logic into a tiny pure helper in `src/lib/validate-metric-refs.ts` so FE and chat share the same algorithm (DRY with the existing server validator — keep server canonical, FE imports the shape).
2. Implement `useMetricRunnability(metric)` — reads `meta` from existing catalog meta cache, calls the helper, returns memoized result.
3. Build `MetricRunnabilityWarning`: yellow background, ⚠ icon, copy "This metric is currently a draft — Cube schema is missing: `mf_users.paid_installs`, `mf_users.new_users`. Running it will fail.", with a `<button>` "Run anyway" that calls `metricOverrideStore.allow(metric.id)`.
4. In `use-test-run.ts`, before `cubejsApi.load(query as never)`, check `useMetricRunnability(metric)` — if broken AND not overridden, throw a sentinel error caught by the calling UI which renders the warning. Run button stays clickable; clicking it just re-renders the warning.
5. Same pattern in metric-detail Run host (find via Grep for `cubeApi.load` + metric context).
6. Chat: add `force?: boolean` to `preview_cube_query` Zod schema. If metric is `draft` (or has missing refs against the resolver's view) AND `!force`, return structured `{ status: 'metric-draft', missingRefs, hint: 'pass force:true to attempt anyway' }`. Same for `explain_cube_sql` (which may not even need Cube — only block if it would dispatch SQL gen against missing fields).
7. Add session-store unit test: override flips state for one metric, survives re-renders, resets on store reset.
8. Smoke: open metric-detail for a broken metric (e.g. `npu`), confirm Run shows warning, no `/cubejs-api/v1/load` request in network tab until "Run anyway".

## Todo List

- [ ] Create `validate-metric-refs.ts` (FE port; ≤60 LOC)
- [ ] Create `use-metric-runnability.ts`
- [ ] Create `metric-override-store.ts` (Zustand slice, session-scoped)
- [ ] Create `metric-runnability-warning.tsx`
- [ ] Wire into NewMetric step-6 Run
- [ ] Wire into NewMetric step-6 dimension-view Run
- [ ] Wire into metric-detail Run
- [ ] Add `force?:boolean` to chat `preview_cube_query`
- [ ] Add `force?:boolean` to chat `explain_cube_sql`
- [ ] Unit test override store
- [ ] Network-tab smoke test for `npu`

## Success Criteria

- C1. Opening metric-detail for `npu` (broken) shows the yellow warning, Run button does not fire a network call to `/cubejs-api/v1/load`.
- C2. Clicking "Run anyway" hides the warning for that metric in the same session; reload re-shows it.
- C3. Chat `preview_cube_query({id:'npu'})` returns `status:'metric-draft'`; same call with `force:true` proceeds to Cube and surfaces the raw UserError if any.
- C4. cube_api log window `'not found for path'` count drops materially on next dev session (target: <5/min during normal browsing).

## Risk Assessment

- R1. False positives if `meta` is stale. Mitigation: the catalog meta hook already revalidates on game switch; runnability returns `status:'ok'` (fail-open) when meta is empty.
- R2. User confusion if they want to debug *why* a metric is broken — the warning must include the actual missing refs verbatim.
- R3. Duplicated validator logic between server (`metric-ref-validator.ts`) and FE port. Mitigation: keep the FE port ≤60 LOC and add a vitest comparing both against the same fixture.

## Security Considerations

- None — this is purely a client-side / chat-tool short-circuit. No new endpoints, no auth surface.

## Next Steps

- This phase is the actual cube_api-load lever. Auto-draft (shipped in `244e19f`) gives the passive visual signal; this phase makes it an active gate at the network call.
- Unblocks phase-03 (certify flow) — once Run is gated, the natural next user need is "how do I un-draft this once it's fixed?", which phase-03 answers.
