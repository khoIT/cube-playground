---
title: "Perf restructure: zustand store, lazy routes, query-builder context teardown"
description: "Six-phase performance restructure addressing dim/measure click lag, tab-switch lag, and cold start. Internals-only — UX, URL contract, and visible behavior preserved verbatim. Mode: TDD per phase. Bookended by Phase 1 baseline + Phase 6 comprehensive before/after report."
status: in_progress
priority: P2
branch: "segment_dimension"
tags: [perf, refactor, zustand, code-splitting, tdd, internals-only]
blockedBy: []
blocks: []
created: "2026-05-17T23:30:00.000Z"
createdBy: "ck:plan"
source: skill
---

# Perf restructure: zustand store, lazy routes, query-builder context teardown

## Overview

Cube-playground has become sluggish on three interactions:

1. Toggling a dimension or measure in the Query Builder side panel.
2. Switching between top-nav tabs (Playground / New Metric / Catalog).
3. Cold first-paint.

Root causes (verified by scout):

- `QueryBuilderContext.Provider` value is a fresh object literal every render → 80 consumers across 37 files re-render on every state change (`src/QueryBuilderV2/QueryBuilder.tsx:181`). (Verified grep, post red-team correction.)
- `useQueryBuilder` returns `JSON.parse(JSON.stringify(query))` every render — full deep-clone (`src/QueryBuilderV2/hooks/query-builder.ts:1400`).
- `KeepAliveRoute` keeps every visited page mounted with `display:none`; background pages keep running effects and re-rendering on cross-cutting state changes (`src/index.tsx:53`).
- No `React.lazy`. Antd 4, recharts, graphiql, prismjs, flexsearch, react-beautiful-dnd, @cube-dev/ui-kit all in the initial chunk.
- `QueryBuilderSidePanel` in-place `.sort()` mutation + `useMemo` deps that omit half their reads.
- `NewMetricPage` already splits per-step bodies (red team C6); only the in-shell auto-name effect remains as a render-amplifier.

Brainstorm: [`../reports/brainstorm-260517-performance-restructure.md`](../reports/brainstorm-260517-performance-restructure.md)

**Mode: TDD per phase.** Tests precede implementation. Each phase locks the *current* observable behavior with tests, then refactors underneath. Where unit tests aren't natural (profiling, route-level lazy), TDD = "capture baseline / write smoke spec / assert no regression".

**Bookends:** Phase 1 captures baseline traces + render counts. Phase 6 produces a comprehensive before-vs-after report against that baseline so the "feel test" acceptance is auditable.

## Hard Constraints (UX-untouched contract)

| Preserved | Source |
|---|---|
| URL contract `?query=…`, `#/build?cube=…&measure=…&time=…&range=…` | `QueryBuilder.tsx:116` |
| `hashchange` deep-link handler | `QueryBuilder.tsx:116` |
| `/playground/context` + `/playground/token` shims | `App.tsx`, `index.tsx` |
| KeepAliveRoute's *visible* behavior (query/result set/SQL/durations survive tab switch) | replicated via Zustand store-factory + cubeApi promotion |
| antd + cube-ui-kit + styled-components markup | no design-system swap |
| i18n, theme, SecurityContext provider chain | `index.tsx` |
| Multi-tab QueryTabs UX (each tab's query/results independent) | per-instance store factory, not module singleton |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Baseline profiling](./phase-01-baseline-profiling.md) | Code Complete (probe + tests landed; manual trace capture pending) |
| 2 | [Lazy route splitting](./phase-02-lazy-route-splitting.md) | Complete |
| 3 | [Zustand stores](./phase-03-zustand-stores.md) | Complete |
| 4 | [Side panel + new metric memo cleanups](./phase-04-side-panel-new-metric-memo-cleanups.md) | Complete |
| 5 | [Query builder context teardown](./phase-05-query-builder-context-teardown.md) | Step 5.0 Complete (decision gate pending manual measurement; 5.A–F deferred) |
| 6 | [Comprehensive perf report before vs after](./phase-06-comprehensive-perf-report-before-vs-after.md) | Code Complete (template + scaffolding landed; numeric capture pending) |

Order rationale: profile → cheap wins (lazy routes) → store plumbing → memo cleanups (validates store under load) → big migration last → final perf report tying it all together.

## Dependencies

None blocking. The wizard plans this might overlap with — `260517-1500-new-metric-fullpage-6step-rebuild` and `260517-1930-new-metric-multi-source-multi-input` — are now `completed`. `260517-2230-new-metric-dim-segment-authoring` is independent and can land in either order.

## Success Criteria (plan-level)

- [ ] Phase 1 baseline captured and committed to `reports/perf-baseline.md`.
- [ ] Each phase's tests pass before its implementation lands.
- [ ] No UX regression on: playground query → results → SQL → tab away → tab back; new metric 6-step happy path; catalog browse + detail panel; metric card route.
- [ ] URL contract bit-identical for `?query=…` and `#/build?cube=…&measure=…` deep links.
- [ ] Subjective feel-test PASS on the three pain interactions.
- [ ] Multi-tab (QueryTabs) behavior preserved: each tab keeps its own query / results / pivot. **No singleton-store collapse.**
- [ ] Phase 6 produces `reports/perf-before-vs-after.md` with quantified deltas vs Phase 1 baseline.

## Red Team Review

### Session — 2026-05-17

**Findings:** 15 (15 accepted, 0 rejected)
**Severity breakdown:** 6 Critical, 9 High
**Reviewer panel:** Failure Mode Analyst (Flow Tracer), Assumption Destroyer (Scope Auditor), Scope & Complexity Critic (Contract Verifier).
**Substitution:** Scope & Complexity Critic substituted for Security Adversary — this plan has zero security/auth/payments/data-integrity surface.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| C1 | Singleton Zustand store collapses N tabs. Must use store-factory per QueryBuilder instance OR per-tab keying. Evidence: `QueryBuilderContainer.tsx:142-160`, `QueryTabs.tsx:124`. | Critical | Accept | Phase 3 |
| C2 | KeepAlive's real job is `cubeApi` + `mutexRef` preservation, not just observable state. Store can't replicate without promoting `cubeApi`. Evidence: `QueryBuilder.tsx:40-46`, `query-builder.ts:124`. | Critical | Accept | Phase 5 |
| C3 | `persist({query})` collides with URL `?query=` contract. Store hydrates before URL parse → deep-links silently ignored. Evidence: `QueryBuilderContainer.tsx:131-148`. | Critical | Accept | Phase 3 |
| C4 | Context value contains live functions (`runQuery`, `setQuery`, `simpleUpdaters`) closing over `cubeApi`, refs, `setState`. These can't become store selectors. Must split state-slices (store) from actions (separate hook). Evidence: `query-builder.ts:266-337, 1445`. | Critical | Accept | Phase 5 |
| C5 | Deep-clone removal breaks current mutation patterns: `prepareQuery` rewrites `query.order`; `queryValidator` mutates `queryCopy.timezone`. Evidence: `prepare-query.tsx:3-13`, `QueryBuilder.tsx:50-58`. | Critical | Accept | Phase 5 |
| C6 | Phase 4 NewMetric step-extraction was gold-plating — `*-body.tsx` files already exist and `NewMetricPage.tsx:315-410` already mounts only the active step. Reduce Phase 4 NewMetric work to the auto-name effect. Evidence: 6 `*-body.tsx` files, `renderStep()` dispatcher. | Critical | Accept | Phase 4 |
| H1 | `cubeList` memo deps recipe in Phase 4 stuffs fresh-each-render arrays into deps → strictly *worse* re-renders. Must stabilize upstream arrays first. Evidence: `QueryBuilderSidePanel.tsx:110-117, 144`. | High | Accept | Phase 4 |
| H2 | Phase 5 = 1-week 40-PR migration. Root cause = 5-line `useMemo` Provider wrap + 1-line clone removal. Insert Step 5.0 = surgical-fix-only PR; measure; decision gate before 5.D. | High | Accept | Phase 5 |
| H3 | Lazy routes won't shrink chunks while `src/pages/index.tsx` does `export *`. Must rewrite that file. Evidence: `src/pages/index.tsx:1-5`. | High | Accept | Phase 2 |
| H4 | 4 test files mock `useQueryBuilderContext` module-level; after migration the mocks go inert. Phase 5 must enumerate them and migrate to store-mock. Evidence: `use-existing-tags.test.ts:6-12`, `use-find-similar.test.ts:6-12`, `use-reachable-members.test.ts:146-155`. | High | Accept | Phase 5 |
| H5 | 6 non-QB consumers read `useAppContext().token`. Phase 5.F can't delete the field until they migrate. Evidence: `use-new-metric-meta.ts:46,70,105`, `use-test-run.ts:25,54`, `use-catalog-meta.ts`, `SecurityContextProvider.tsx`, `user-menu.tsx`, `SchemaPage.tsx`. | High | Accept | Phase 3, 5 |
| H6 | Mirror-write bridge undefined for `resultSet`/`pivotConfig` (fresh objects per render); will loop without structural-equality comparator. Evidence: `query-builder.ts:298-302, 471, 1078-1086`. | High | Accept | Phase 3, 5 |
| H7 | KeepAlive removal discards in-flight `cubeApi.load`/`cubeApi.sql`; `mutexRef` also read by `distribution-mode.tsx:35,93` and `ValuesInput.tsx:97,105`. Must add abort/cleanup. | High | Accept | Phase 5 |
| H8 | `query-builder.ts:259-264` mutates `cubes` in place too; deep-clone audit must cover this, not only `query`. | High | Accept | Phase 5 |
| H9 | `hashchange` listener registers on `[meta]` not on mount → race window between lazy resolve, meta load, and URL paste. Evidence: `QueryBuilder.tsx:116-174`. | High | Accept | Phase 2 |

### Whole-Plan Consistency Sweep

- **Files reread:** plan.md, phase-01-baseline-profiling.md, phase-02-lazy-route-splitting.md, phase-03-zustand-stores.md, phase-04-side-panel-new-metric-memo-cleanups.md, phase-05-query-builder-context-teardown.md.
- **Decision deltas checked:** 8 — store-factory (not singleton); persist excludes `query`; per-step extraction dropped (C6); module-split deferred; KeepAlive removal blocked on cubeApi/mutex promotion; deep-clone replaced by structuredClone + audit (not deepFreeze); 80 consumers / 37 files (not "80+/40"); Step 5.0 surgical-fix gate inserted.
- **Reconciled stale references:** 2 — plan.md "80+ consumers / 40 files" → corrected to "80 / 37"; phase-03 implementation step still listed `query` in partialize → corrected.
- **Unresolved contradictions:** 0.

## Validation Log

### Session 1 — 2026-05-17

**Trigger:** Post-red-team validation pass before implementation.
**Questions asked:** 4
**Verification pass:** Skipped — `## Red Team Review` section already contains full file:line verification evidence (per `validate-workflow.md` Step 2.5 guard).

#### Questions & Answers

1. **[Tradeoffs]** Phase 5.0 surgical-fix gate criterion — what's the tiebreaker when feel is ambiguous?
   - Options: ≥50% drop on dim-toggle render count (Recommended) | Pure feel test | Both (feel + ≥25% drop)
   - **Answer:** ≥50% drop on dim-toggle render count (Recommended)
   - **Rationale:** Falsifiable, measurable, single-number gate. Decides whether 1 week of Phase 5.A-5.F migration ships.

2. **[Architecture]** Mid-flight query abort UX on route-switch-then-return.
   - Options: Silent cancel + 'Result outdated' badge (Recommended) | Silent cancel + auto re-run | Visible 'Query cancelled' state
   - **Answer:** Silent cancel + 'Result outdated' badge on return (Recommended)
   - **Rationale:** Reuses existing `isResultOutdated` UX surface — no new state to design. Matches today's behavior for completed queries.

3. **[Architecture]** cubeApi promotion to store — cache strategy.
   - Options: Single-entry cache, evict on key change (Recommended) | LRU max 3 | Unbounded
   - **Answer:** Single-entry cache, evict on key change (Recommended)
   - **Rationale:** Matches today's `useMemo(() => cube(apiToken, { apiUrl }), [apiUrl, apiToken])` semantics at `QueryBuilder.tsx:40-46`. No behavior delta.

4. **[Risks]** Phase 6 verdict FAIL handling.
   - Options: Follow-up plan (Recommended) | Define rollback now | Partial-accept per phase
   - **Answer:** Write a follow-up plan (Recommended)
   - **Rationale:** Phase 1-5 changes are net-positive even if perf goal under-shoots. Network-bound latency would surface as a separate request-coalescing plan; doesn't justify reverting render-count wins.

#### Confirmed Decisions

- Phase 5.0 decision gate: feel test PASS AND ≥50% drop in SidePanel render count vs Phase 1 baseline.
- Mid-flight abort UX: silent cancel; on return the existing 'result outdated' indicator surfaces. No new UI state.
- cubeApi in store: single-entry cache, evicted when `(apiUrl, apiToken)` changes. Mirrors current useMemo semantics.
- Phase 6 verdict FAIL: write a follow-up plan; do not revert Phase 1-5 work; perf attribution table in the report names the offender for the follow-up.

#### Impact on Phases

- Phase 5: Step 5.0 gains a quantified gate (≥50% render drop). Step 5.E mid-flight test specifies "result outdated badge" assertion. cubeApi promotion specifies single-entry cache.
- Phase 6: Verdict section gains follow-up-plan trigger. Risk row updated.

### Whole-Plan Consistency Sweep

- **Files reread:** plan.md, phase-01-baseline-profiling.md, phase-02-lazy-route-splitting.md, phase-03-zustand-stores.md, phase-04-side-panel-new-metric-memo-cleanups.md, phase-05-query-builder-context-teardown.md, phase-06-comprehensive-perf-report-before-vs-after.md.
- **Decision deltas checked:** 4 — Step 5.0 quantified gate; abort UX → outdated badge; cubeApi single-entry cache; Phase 6 FAIL → follow-up plan.
- **Reconciled stale references:** 0 (no pre-validation prose contradicted the new decisions).
- **Unresolved contradictions:** 0.

## Recovery Note (2026-05-17)

Plan files were re-scaffolded by `ck plan create` when run a second time on the same directory. Content restored from conversation context after a Phase 6 add. No phase-content drift introduced by the recovery; cross-reference the Red Team Review log above for the authoritative set of decisions.
