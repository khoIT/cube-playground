# Brainstorm — New Metric Full-Page 6-Step Rebuild

**Date:** 2026-05-17
**Author:** khoitn (with Claude)
**Status:** Approved, ready for `/ck:plan --tdd`
**Reference design:** `New Metric Walkthrough _standalone_.html` (decoded — 6-step interactive React walkthrough w/ left rail + main + right rail shell)
**Supersedes:** `plans/260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces/` (salvage P1 meta foundation + P2 YAML emitter extensions; rest dropped)

---

## Problem

Current New Metric flow is a fullscreen Dialog with 3 stacked-section steps (Define → Identify → Preview). It crams Source + Operation + Of + Filter into one Define step and exposes only a YAML preview in the right rail. The reference walkthrough is a fundamentally different UX: a routed full-page 6-step wizard with persistent identity hero, vertical step nav, validation card, per-step contextual right rail, real per-column data quality stats, AND/OR filter builder w/ cohort funnel, and a dedicated test-run step. Rebuild to match the reference 1:1.

## Locked Decisions

| Topic | Decision |
|-------|----------|
| Hosting | **Full-page route** `/metrics/new`. Header `New metric` button becomes `<Link>`. |
| Step count | **6 steps** — Source → Operation → Column → Filters → Identity → Test run. |
| Data fidelity | **Real per-column stats** (histogram, null %, distinct, samples, sparkline, cohort funnel) via on-the-fly Cube `/load` queries. **Lazy on column click + in-memory cache** + skeletons. |
| Submit backend | Existing **`postSchemaWrite` direct YAML write**. No PR/branch/Slack flow. |
| Success state | **Full-page success view** w/ check icon + metric name + cube target + `View in Playground` / `Start another metric` CTAs. No fake PR/reviewer rows. |
| Filter model | **Full AND/OR with grouped expressions**, emit as single `sql:` fragment to Cube measure `filters[]`. |
| Identity fields | **grain + visibility** persisted under `meta:`. **Custom SQL** operation ships w/ visible "review required" badge. |
| Plan posture | **Supersede** old v2 plan. Salvage P1 (extended `/meta` + reachability fix) + P2 (draft state + YAML generator extensions). Drop P3-P8. |
| Feature flag | Route query param **`?v=2`** — v1 dialog stays reachable for fallback during rollout. |
| Draft persistence | **`localStorage`** key `gds-cube:new-metric-draft-v2`. Survives reload. |
| Discard | Confirm dialog → `navigate('/playground')` always. |
| Test-run time range | `Yesterday / Last 7d / Last 30d / Custom`. **Custom** reuses existing playground date range picker component. |

## Evaluated Approaches

### A — Big-bang replacement (1 PR)
Full new tree + delete old in same PR.
- ✅ Single coherent change, no dual paths.
- ❌ ~3.7k LOC PR; hard to demo mid-flight; all-or-nothing review.

### B — Phased parallel (RECOMMENDED) ⭐
New route shipped step-by-step behind `?v=2`. Old dialog reachable until P8.
- ✅ Each phase demoable end-to-end. P1 foundation lands regardless of UI velocity. Low merge risk.
- ❌ Slightly longer calendar; two paths briefly coexist.

### C — In-place refactor of existing Dialog
Mutate `NewMetricDialog.tsx` step-by-step.
- ❌ Ruled out by full-page-route + supersede decisions.

## Recommended Architecture

### Routing & entrypoint
- `react-router-dom@6` already in stack → add `<Route path="/metrics/new" element={<NewMetricPage />} />` in `src/App.tsx`.
- `NewMetricButton.tsx` swaps `DialogTrigger` for `<Link to="/metrics/new?v=2">`. Pre-existing `?cube=` deep-link mechanism extends to pre-seed Source.
- Old `NewMetricDialog.tsx` deleted in P8 when v2 fully ships.

### State shape (extends `use-new-metric-draft.ts`)
```ts
type FilterLeaf  = { kind: 'leaf';  column: string; op: FilterOp; values: string[] };
type FilterGroup = { kind: 'group'; op: 'AND' | 'OR'; children: FilterNode[] };
type FilterNode  = FilterLeaf | FilterGroup;

type Grain      = 'hourly' | 'daily' | 'weekly' | 'monthly';
type Visibility = 'team' | 'org' | 'private';
type Format     = 'number' | 'currency-vnd' | 'currency-usd' | 'percent' | 'duration';

type NewMetricDraftV2 = {
  sourceCube:  string | null;
  operation:   Operation;          // + 'median' | 'percentile' | 'custom'
  ofMember:    string | null;
  ofMemberB:   string | null;      // ratio op
  customSql:   string | null;      // when operation === 'custom'
  filterTree:  FilterNode;         // root is always a group, default { kind: 'group', op: 'AND', children: [] }
  name:        string;
  title:       string;
  description: string;
  format:      Format;
  grain:       Grain;
  visibility:  Visibility;
  tags:        string[];
  testRun:     { status: 'idle' | 'running' | 'complete' | 'error'; timeRange: 'yesterday'|'7d'|'30d'|'custom'; customRange?: [string, string]; result?: TestRunResult };
  filterMode:  'visual' | 'sql' | 'both';
};
```
Persist whole draft to `localStorage` on every mutation (debounced 200 ms).

### New hooks (each < 200 LOC, separate files)
| Hook | Purpose | Inputs |
|---|---|---|
| `use-column-stats.ts` | Per-column stats fetcher (count, null %, distinct, samples, histogram, sparkline). Lazy on selection. In-memory cache keyed `{cube,col}`. Abort prior on switch. | cube, column, op |
| `use-cohort-funnel.ts` | Progressive row counts for each filter rung. Debounce 400 ms; abort prior. | cube, filterTree |
| `use-eligible-columns.ts` | Filter cube columns by `op.accepts` (`numeric` / `integer` / `string` / `date` / `boolean` / `2-measures` / `all`). Reused by Step 3 + Step 2 right rail. | cube, op |
| `use-test-run.ts` | Compile YAML → run `/load` → format hero stats + trend + dim breakdown. Auto-pick breakdown dim from cube primary dims. | full draft |
| `use-new-metric-draft.ts` (extend existing) | v2 state, localStorage persistence, validation. | — |

### Layout components (new `src/NewMetric/shell/`)
- `<Shell>` — orchestrates TopBar + LeftRail + Main + RightRail
- `<TopBar>` — logo, breadcrumb, Save draft / Help / Discard
- `<LeftRail>` — identity hero + 6 step rows + validation card
- `<StepHeader>` — `Step N` pill + title + sub + actions slot
- `<StepFooter>` — `Step X of 6` + Back / Skip / Continue (or Submit)
- `<RightRail>` — title + subtitle + content slot

### Step component layout (each in `src/NewMetric/steps/step-N-name/`)
```
step-N-name/
├── index.tsx              // wires up Shell w/ body + rail
├── body.tsx               // main center pane
├── rail.tsx               // right-rail content
├── components/            // step-private sub-components (cards, popovers, etc.)
└── __tests__/
```

### YAML emitter extensions (`yaml/generate-measure-yaml.ts`)
- `filterTree` → recursive flatten → single `sql: "(cond1 AND cond2) OR (cond3)"` string. Type-aware value quoting. One entry in measure `filters: []`.
- `grain` / `visibility` → `meta.grain` / `meta.visibility`.
- `operation === 'custom'` → emit raw `sql:` w/ `type: number` + `# REQUIRES REVIEW` comment header. Client-side block obvious DDL tokens (`;`, `--`, `DROP`, `DELETE`, `INSERT`, `UPDATE`, `ALTER`).

## Phased Roadmap (Shape B)

| Phase | Scope | Effort | Demoable |
|---|---|---|---|
| **P1** | Foundation (salvaged): `cubeApi.meta()` → `?extended=true`, draft state v2, YAML emitter v2, filter-tree module, unit tests. No UI. | 1d | ❌ (lib only) |
| **P2** | Shell + TopBar + LeftRail + StepFooter + Step 1 Source. Route `/metrics/new?v=2`. Discard works. localStorage persistence. | 1.5d | ✅ |
| **P3** | Step 2 Operation. 10 op cards (incl. Custom SQL). Segmented Common/All/Advanced. Right-rail formula + eligible cols. | 0.75d | ✅ |
| **P4** | Step 3 Column. `use-column-stats` hook. Card + table view toggle. "Why only N?" popover. Right-rail column health + sparkline. | 2d | ✅ |
| **P5** | Step 4 Filters. AND/OR group tree builder. Visual / SQL / Both modes. `use-cohort-funnel` hook. Right-rail funnel + result preview. | 2d | ✅ |
| **P6** | Step 5 Identity. Name/title/desc/format (5 options w/ preview)/grain/visibility/tags combo. Right-rail live YAML. | 1d | ✅ |
| **P7** | Step 6 Test run. Idle / running / results states. Hero stats + recharts trend + dim breakdown table + compiled SQL via `/sql`. Submit checklist (no reviewers). | 1.5d | ✅ |
| **P8** | Success page. Flip flag default to v2. Delete v1 dialog tree. Update header button to route. | 0.5d | ✅ |

**Total:** ≈ 10.25 focused days · calendar 2.5-3 weeks.

## Touchpoints

**Salvage from old v2 plan (P1 + P2 work):**
- `src/QueryBuilderV2/hooks/query-builder.ts` — flip `cubeApi.meta()` to `extended=true`
- `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` — extend to v2 shape
- `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` — extend emitter
- `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts` — reused as-is
- `src/QueryBuilderV2/NewMetric/api.ts` — `postSchemaWrite` reused as-is

**New code (~25 files, ~3.7k LOC):**
- `src/NewMetric/NewMetricPage.tsx` — route component
- `src/NewMetric/shell/` — Shell + TopBar + LeftRail + StepHeader + StepFooter + RightRail
- `src/NewMetric/steps/step-1-source/` through `step-6-test-run/`
- `src/NewMetric/steps/success/`
- `src/NewMetric/hooks/` — `use-column-stats`, `use-cohort-funnel`, `use-eligible-columns`, `use-test-run`
- `src/NewMetric/filter-tree/` — types + flattener + validator + tests

**Modified:**
- `src/App.tsx` — add `/metrics/new` route
- `src/QueryBuilderV2/NewMetric/NewMetricButton.tsx` — swap `DialogTrigger` for `<Link>`
- `src/QueryBuilderV2/QueryBuilder.tsx` — `?cube=` deep-link reader (already planned)

**Deleted (P8):**
- `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx`
- `src/QueryBuilderV2/NewMetric/steps/step-define.tsx` / `step-identify.tsx` / `step-preview.tsx`
- `src/QueryBuilderV2/NewMetric/components/stepper.tsx`, `wizard-footer.tsx`
- (Sections under `NewMetric/sections/` retained if reused, otherwise dropped)

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Histogram queries slow on 284M-row cubes (`mf_sessions`) | Med | Skeleton until ready; abort prior on column switch; surface "estimate · X MB scanned" hint; cache per-session |
| Cohort funnel re-fires on each filter edit | Med | Debounce 400 ms; abort prior; pause queries while typing in value chip |
| AND/OR → single SQL fragment value quoting | Med | Type-aware emitter (numbers raw, strings single-quoted w/ escape, IN lists parenthesised); reject if column type unknown; unit tests per leaf type |
| Custom SQL operation ships dangerous fragments | High | Client-side block of `;` `--` `DROP` `DELETE` `INSERT` `UPDATE` `ALTER` `TRUNCATE` `CREATE`; visible "review required" amber badge in left-rail validation; Cube parser is final gate on hot-reload |
| localStorage draft survives across users on shared browser | Low | Acceptable for POC; document; later add session-keyed namespace |
| New `/metrics/new` route loses `AppContext` (cubeApi, token, meta) | Low | `NewMetricPage` mounts inside `<AppProvider>` same as `/playground`; verify in P2 |
| Test-run dimension breakdown picks wrong dim | Low | Default to first non-time dim of source cube; allow user to switch via segmented control (mockup shows tier/age/platform) |
| `?v=2` flag forgotten in URLs from external links | Low | Default to v2 once P7 lands; v1 reachable only via `?v=1`; remove v1 in P8 |

## Success Criteria

1. Header `New metric` button navigates to `/metrics/new?v=2`; v1 dialog still reachable via `?v=1` until P8.
2. All 6 steps render in defined order with the documented left-rail + center + right-rail shell.
3. Step 1: cube/view grid w/ rows·cols·refreshed·domain·kind·tags pulled from `/meta?extended=true`. Right-rail shows selected source's column-type histogram.
4. Step 2: 10 operation cards (Sum, Count, Count distinct, Average, Min, Max, Median, Percentile, Ratio, Custom SQL) with Common/All/Advanced segmented filter. Right-rail shows formula + eligible columns + "don't use for" callout.
5. Step 3: eligible columns filtered by `op.accepts`. Card + table toggle. "Why only N?" popover. Real null %, distinct, samples, histogram, min/avg/max via lazy `/load` queries. Right-rail column health (KPI + DQ checks + 30d sparkline).
6. Step 4: AND/OR group builder (Visual / SQL / Both modes). Real cohort funnel via progressive count queries. Result preview block.
7. Step 5: name (snake_case validated) / title (required) / description / format (5 options w/ preview) / grain (4 options) / visibility (3 options) / tags (combo w/ suggestions). Right-rail shows live YAML matching what will be written.
8. Step 6: idle → Run test → running w/ progress lines → results (3 hero stats + recharts trend + dim breakdown table + compiled SQL block). Submit checklist (5 items, no reviewers).
9. Submit: writes YAML via `postSchemaWrite`, navigates to full-page success view w/ `View in Playground` + `Start another metric`.
10. Discard: confirm dialog → navigate to `/playground`. Draft cleared from localStorage.
11. Reload mid-flight: draft restored from localStorage, lands on last active step.
12. All new files < 200 LOC. Filter-tree module + YAML emitter + stats hook covered by unit tests.

## Out of Scope

- Editing existing measures (new-metric only)
- Tag rename / merge / canonicalisation
- Multi-cube source / cross-cube measures
- PR / branch / reviewer / Slack workflow
- Mobile responsive layout
- i18n
- Pre-aggregation enablement (sibling concern)
- Catalog browse view (sibling concern)
- Sidebar tag-filter chips (sibling concern)
- Hand-authored YAML reverse-parse into draft (one-way emit only)

## Open Questions

1. Test-run dimension breakdown — auto-pick first non-time dim, or let user select up-front? Default proposed: first non-time dim w/ segmented switcher above the table.
2. Custom SQL — exact deny-list of tokens? Initial list above; tighten in P3.
3. Save draft button in TopBar (mockup) — does it do anything beyond the auto-localStorage write? Default: no-op + "Draft saved" toast (UI placeholder).
4. Cohort funnel base population query — count `*` of source cube every time, or pull from a cached `rows` field on `/meta` if exposed?

---

**Next step:** hand off to `/ck:plan --tdd` w/ this report as context.
