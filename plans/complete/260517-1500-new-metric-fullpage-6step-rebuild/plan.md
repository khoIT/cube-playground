---
title: "New Metric Full-Page 6-Step Rebuild"
description: "Replace the 3-step modal New Metric wizard with a routed full-page 6-step flow matching the reference walkthrough — left identity rail, center body, per-step contextual right rail, real per-column stats, AND/OR filter tree, dedicated test run."
status: completed
priority: P2
branch: "new_metric"
tags: [feature, wizard, full-page, 6-step, real-stats, and-or-filter, custom-sql, tdd]
blockedBy: []
blocks: [260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces, 260517-1930-new-metric-multi-source-multi-input, 260517-2230-new-metric-dim-segment-authoring]
created: "2026-05-17T15:00:00.000Z"
createdBy: "ck:plan"
source: skill
---

# New Metric Full-Page 6-Step Rebuild

## Overview

Rebuild the New Metric wizard as a routed full-page 6-step flow matching `New Metric Walkthrough _standalone_.html`. Replaces the 3-step Dialog at `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx`. Steps: Source → Operation → Column → Filters → Identity → Test run. Shell = top app bar + 260 px left rail (identity hero + vertical step nav + 4/4 validation card) + center main (step header + body + footer) + 420 px right rail (step-contextual content). Real per-column stats (histogram, null %, distinct, samples, sparkline) via lazy Cube `/load` queries on column click. AND/OR filter tree with cohort impact funnel. 9 aggregation operations (Custom SQL dropped per red-team — see § Locked Decisions). `grain` + `visibility` persisted under `meta:`. Direct YAML write retained — no PR / Slack flow. Feature flag `?v=2` until P8 flips the default and deletes v1.

Brainstorm: [`../reports/brainstorm-260517-new-metric-fullpage-6step-rebuild.md`](../reports/brainstorm-260517-new-metric-fullpage-6step-rebuild.md)

Mode: **TDD per phase** — tests precede implementation for the foundation modules (filter tree, YAML emitter, draft state, stats hook, cohort hook) and for each step's wiring contract.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Foundation extended meta state yaml filter-tree](./phase-01-foundation-extended-meta-state-yaml-filter-tree.md) | Complete |
| 2 | [Shell source route localstorage](./phase-02-shell-source-route-localstorage.md) | Complete |
| 3 | [Operation step with custom sql](./phase-03-operation-step-with-custom-sql.md) | Complete |
| 4 | [Column step stats hook](./phase-04-column-step-stats-hook.md) | Complete |
| 5 | [Filters step and-or tree cohort funnel](./phase-05-filters-step-and-or-tree-cohort-funnel.md) | Complete |
| 6 | [Identity step grain visibility tags](./phase-06-identity-step-grain-visibility-tags.md) | Complete |
| 7 | [Test run step real execution](./phase-07-test-run-step-real-execution.md) | Complete |
| 8 | [Success page flag flip v1 removal](./phase-08-success-page-flag-flip-v1-removal.md) | Complete |

## Sequence

```
P1 (foundation, pure modules + tests) ──▶ P2 (shell + Source + route)
                                            └─▶ P3 (Operation)
                                                  └─▶ P4 (Column + stats hook)
                                                        └─▶ P5 (Filters + cohort hook)
                                                              └─▶ P6 (Identity)
                                                                    └─▶ P7 (Test run)
                                                                          └─▶ P8 (Success + flag flip + v1 delete)
```

Strictly linear. Each phase is end-to-end demoable behind `?v=2` once P2 lands.

## Locked Decisions

- Routed full-page at `/metrics/new`; feature-flagged via `?v=2`; old Dialog reachable via `?v=1` until P8.
- **Stack constraint:** `react-router-dom@^5.3.4` (RR5) + HashRouter — use `useHistory` / `useLocation` / `<Route component={...}>` / render-prop. NO RR6 idioms (`<Routes>`, `element=`, `useSearchParams`, `useNavigate`).
- **New code lives at `src/QueryBuilderV2/NewMetric/full-page/`** (single namespace alongside salvaged foundation in `src/QueryBuilderV2/NewMetric/`). Do NOT create top-level `src/NewMetric/`.
- 6 steps in the exact mockup order.
- Real per-column stats via lazy `/load` queries on column click + in-memory session cache + skeletons. **Concurrency = `runIdRef` stale-token guard** (matches existing `use-live-preview.ts` pattern; Cube SDK `load()` does not accept AbortSignal).
- AND/OR filter tree → flattened to a single `sql:` fragment in measure `filters[]` (Cube semantics). **Value-quoting:** type-aware, `value.replace(/'/g, "''")`, reject control bytes + CR/LF, property-tested in P1.
- `grain` / `visibility` persisted under `meta.grain` / `meta.visibility`.
- **Custom SQL operation DROPPED** (red-team consensus: client-side deny-list is theater w/o server-side parser; no reviewer flow exists downstream to back the "review required" badge). 10 ops → 9. Users wanting custom SQL edit YAML directly.
- Submit retains existing `postSchemaWrite` direct YAML write. **`result.warning === 'meta-not-acknowledged'` surfaces in P7** (existing server policy: 200 + warning on poll timeout, NOT 504); drop the dead 504 branch from v1.
- Final success state: full-page success view with `View in Playground` (→ `/build?cube=<src>`) + `Start another metric` CTAs.
- Draft state persisted to `localStorage` key `gds-cube:new-metric-draft-v2:<tabId>` (per-tab via `sessionStorage` tabId; `BroadcastChannel('new-metric')` for cross-tab "another tab editing" disable). Debounce 200 ms + `beforeunload` + `visibilitychange` flush.
- Discard: confirm dialog → `history.push('/build')` always.
- Test-run time range: `Yesterday / Last 7d / Last 30d / Custom` — **Custom uses antd `DatePicker.RangePicker` directly** (no reusable playground RangePicker exists).
- **Test-run strategy: write-then-load-then-discard.** P7 submit-temp commits YAML, `cubeApi.load`s against the committed measure for hero/trend/breakdown, then auto-discards via `deleteSchemaWrite` (mirrors `use-live-preview.ts`). "Submit metric request" button is a second, persistent commit. Resolves "transient query" punt.
- **No `dangerouslySetInnerHTML` anywhere in the wizard tree** — explicit P1 success criterion w/ XSS-payload unit test.
- **Server-side hardening:** `vite-plugins/schema-write-middleware.ts` gains origin allowlist (block cross-origin); `_audit.jsonl` added to `.gitignore`.
- Supersedes `260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces` (salvage its P2 YAML emitter intent; **drop the P1 `extended=true` flip — already shipped via direct fetch at `query-builder.ts:339-379`**; drop 3-step shell, sidebar enrichment, catalog, pre-agg badge — those return as separate plans if needed).

## Total Effort

≈ 10.25 focused days. Calendar 2.5–3 weeks.

| Phase | Effort | Priority |
|-------|--------|----------|
| P1 | 1d | P0 (gate) |
| P2 | 1.5d | P1 |
| P3 | 0.75d | P1 |
| P4 | 2d | P1 |
| P5 | 2d | P1 |
| P6 | 1d | P2 |
| P7 | 1.5d | P2 |
| P8 | 0.5d | P2 |

## Dependencies

- **Blocks:** [`260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces`](../260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces/plan.md) — this plan supersedes it; that plan should be cancelled when this one starts.
- **Builds on:** `260516-1530-define-metric-wizard` (v1 wizard shipped 8468b8a — provides the YAML write API, reachability hook, draft scaffolding being extended).

## Out of Scope

- Editing tags / fields on existing measures (new-metric flow only)
- Hand-authored YAML reverse-parse into draft (one-way emit only — wizard cannot reopen non-wizard measures)
- PR / branch / Slack / reviewer workflow
- Tag rename / merge / canonicalisation tooling
- Multi-cube / cross-cube measures (single source per metric)
- Pre-aggregation enablement (sibling concern — separate plan if pursued)
- Catalog browse view (sibling concern — separate plan)
- Sidebar tag-filter chips / cluster badge / agg-type chip (sibling concern)
- Mobile-responsive layout
- i18n / Vietnamese translations
- Server-side validation beyond Cube hot-reload acknowledgement
- Permissions / tag ownership / visibility enforcement (`visibility` field is display metadata only)

## Open Questions

1. Test-run dimension breakdown — auto-pick first non-time dim of source cube, or let user select up-front via segmented control above the table? Default proposed: first non-time dim w/ switcher.
2. TopBar "Save draft" button — does it do anything beyond the auto-localStorage write? Default: no-op + "Draft saved" toast.
3. Cohort funnel base population — `<cube>.count` measure (when present per P1 probe) or fall through to "Base count unavailable" empty state. No "rows" field exists on `/meta` (red-team #14).
4. Does `?extended=true` populate `preAggregations` reliably? Re-probe at start of P4 (affects sparkline performance on big cubes).
5. **Median / Percentile YAML mapping** — emit as `type: number` + pre-written `sql: PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x)`? Decide during P1 emitter implementation; if Cube measure type doesn't support, gate the ops behind a "not supported on this cube" empty-state.
6. **Submit retry after `meta-not-acknowledged`** — auto-prompt user to retry, or require manual Re-run? Default proposed: manual (one-time amber toast, no auto-retry).

## Related Reports

- Brainstorm: [`../reports/brainstorm-260517-new-metric-fullpage-6step-rebuild.md`](../reports/brainstorm-260517-new-metric-fullpage-6step-rebuild.md)
- Prior brainstorm (now superseded): [`../reports/brainstorm-260516-1940-new-metric-redesign-tags-live-preview.md`](../reports/brainstorm-260516-1940-new-metric-redesign-tags-live-preview.md)
- Architecture: [`../reports/architecture/cube-mm01-integration-and-schema-reload.md`](../reports/architecture/cube-mm01-integration-and-schema-reload.md), [`../reports/architecture/poc-scoping-and-leadership-decisions.md`](../reports/architecture/poc-scoping-and-leadership-decisions.md)

## Red Team Review

### Session 1 — 2026-05-17
**Findings:** 38 raw → 24 unique after dedup (3 reviewer corroboration on several)
**Severity breakdown:** 6 Critical, 12 High, 6 Medium (factual) + 6 YAGNI reversals
**Reviewers:** Security Adversary (Fact Checker), Failure Mode Analyst (Flow Tracer), Assumption Destroyer (Scope Auditor), Scope & Complexity Critic (Contract Verifier)
**Disposition:** 23 factual findings Accepted (all applied) + 1 YAGNI reversal Accepted (drop Custom SQL); 5 YAGNI reversals Rejected (mockup fidelity preserved per user decision)

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | RR6 idioms used; repo pins RR5 + HashRouter | Critical | Accept | All phases (P2/P5/P6/P7/P8) |
| 2 | P1 `extended=true` flip is a no-op (already shipped via direct fetch) | Critical | Accept | P1 |
| 3 | `/playground` route doesn't exist; actual is `/build` | Critical | Accept | plan.md + P2 + P8 |
| 4 | `AbortController` claim is fabricated; SDK doesn't accept signal | Critical | Accept | P4 + P5 + P7 |
| 5 | `useAppContext` lacks `meta`/`cubejsApi`; need bootstrap layer | Critical | Accept | P1 (new step) + P2 |
| 6 | TagCombo + useExistingTags already exist — P6 reuses | High | Accept | P6 + P8 keep-list |
| 7 | `cubejsApi.sql()` shape wrong in plan snippet | High | Accept | P7 |
| 8 | Playground RangePicker not reusable — use antd directly | High | Accept | plan.md + P7 |
| 9 | 504 path dead code; `meta-not-acknowledged` warning missed | High | Accept | plan.md + P7 |
| 10 | Two-namespace fork — relocate new tree under existing path | High | Accept | All phases (path rewrite) |
| 11 | `?cube=` deep-link not validated against `meta.cubes` | High | Accept | P2 |
| 12 | `flattenToSql` value-quoting under-specified | High | Accept | P1 |
| 13 | No CSRF/origin guard on schema-write middleware | High | Accept | P1 (new server sub-task) |
| 14 | `<cube>.count` measure assumption — fallback in plan broken | High | Accept | P1 (probe) + P4 + P5 |
| 15 | Reachability check optional in `validate()` | Medium | Accept | P1 |
| 16 | localStorage debounce loses last keystroke | Medium | Accept | P1 + P2 |
| 17 | 504 keeps file on disk silently; ratchet of broken YAML | Medium | Accept | P7 |
| 18 | `_audit.jsonl` retains raw YAML — leak if model_repo git-tracked | Medium | Accept | P1 (`.gitignore`) |
| 19 | Multi-tab concurrency unaddressed | Medium | Accept | P1 + P2 |
| 20 | `Operation` type extension breaks v1 typing during transition | Medium | Accept | P1 (Partial Record) |
| 21 | XSS risk via custom token-colored render | Medium | Accept | P1 (success criterion) |
| 22 | P8 deletion order ambiguity for `use-find-similar.ts` | Medium | Accept | P8 |
| 23 | Test-run "transient query" undecided | Critical | Accept | plan.md + P1 + P7 (write-then-load-then-discard) |
| 24 | Drop Custom SQL operation entirely | Critical (YAGNI) | **Accept (user-confirmed reversal)** | plan.md + P1 + P3 |
| 25 | Replace AND/OR tree w/ flat AND list | High (YAGNI) | Reject — user keeps full AND/OR per locked decision |
| 26 | Drop localStorage persistence | High (YAGNI) | Reject — user keeps draft persistence; mitigations from #16+19+21 applied |
| 27 | Drop grain/visibility from meta: (dead metadata) | Medium (YAGNI) | Reject — user keeps mockup parity |
| 28 | Reduce per-column stats to type+samples+null% | High (YAGNI) | Reject — user keeps full mockup parity for stats |
| 29 | Simplify test-run state machine | High (YAGNI) | Reject — folds into #23 resolution; rich UI now backed by real write-then-load query |

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 through phase-08
- Decision deltas checked: 24 (router idiom, route names, namespace, AbortController, AppContext bootstrap, custom-sql drop, RangePicker, sql() shape, submit warning, write-then-load, value-quoting, count probe, CSRF, audit, tab id, dangerouslySetInnerHTML ban, OPERATION_TYPE Partial, P8 grep step, beforeunload flush, reachability mandatory, `?cube=` validation, file-path renames, TagCombo reuse, 504 path)
- Reconciled stale references: All RR6 idioms swept; all `/playground` → `/build`; all `src/NewMetric/` → `src/QueryBuilderV2/NewMetric/full-page/`; all AbortController → runIdRef stale-token
- Unresolved contradictions: 0
