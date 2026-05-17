---
title: "New Metric: Dimension and Segment Authoring"
description: "Extend the full-page New Metric wizard to author dimensions (banding / time-since / passthrough / boolean) and segments alongside measures. Step 0 artifact-kind toggle, per-kind step graph, dispatcher emitter, /api/playground/schema/write extended with `kind`."
status: completed
priority: P2
branch: "multi_metric"
tags: [feature, wizard, dimensions, segments, tdd]
blockedBy: [260517-1500-new-metric-fullpage-6step-rebuild]
blocks: []
created: "2026-05-17T22:30:00.000Z"
createdBy: "ck:plan"
source: skill
---

# New Metric: Dimension and Segment Authoring

## Overview

Today's full-page wizard authors only Cube `measures:`. Liveops 2026 reads dim-shaped (~40 metrics: `payer_tier`, `days_since_install`, …) and segment-shaped (~25 metrics: `vn_users`, `whales`, …) attributes from `mf_users.yml`. This plan extends the wizard with two new authoring kinds — **dimension** and **segment** — using a Step 0 artifact-kind toggle, per-kind step graph, a dispatcher YAML emitter, and a `kind`-aware `/api/playground/schema/write` endpoint. Measure-mode flow is byte-identical to today.

Brainstorm: [`../reports/brainstorm-260517-extend-new-metric-authorize-dims-segments.md`](../reports/brainstorm-260517-extend-new-metric-authorize-dims-segments.md)

Mode: **TDD per phase.** Tests precede implementation for the YAML emitter (per-kind generators + round-trip parse/emit), backend splicer (per-kind required-keys + cross-kind name policy), draft reducer (artifactKind switch state-clears), and step-graph routing. UI bodies get behavior tests around builder→YAML output.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Foundation draft V3 types and auto-name](./phase-01-foundation-draft-v3-types-and-auto-name.md) | Completed |
| 2 | [YAML emitter dispatcher per-kind generators](./phase-02-yaml-emitter-dispatcher-per-kind-generators.md) | Completed |
| 3 | [Backend schema-write kind extension splicer meta-poll](./phase-03-backend-schema-write-kind-extension-splicer-meta-poll.md) | Completed |
| 4 | [Step 0 artifact picker per-kind step graph](./phase-04-step-0-artifact-picker-per-kind-step-graph.md) | Completed |
| 5 | [Dimension UI kind picker and four builders](./phase-05-dimension-ui-kind-picker-and-four-builders.md) | Completed |
| 6 | [Segment UI filter tree reuse identity](./phase-06-segment-ui-filter-tree-reuse-identity.md) | Completed |
| 7 | [Test-run preview per kind segment API spike](./phase-07-test-run-preview-per-kind-segment-api-spike.md) | Completed |
| 8 | [Kind badges UX pickers find-similar rails](./phase-08-kind-badges-ux-pickers-find-similar-rails.md) | Completed |

## Sequence

```
P1 (types + draft V3 + auto-name) ──▶ P2 (emitter dispatcher + 3 generators)
                                          └─▶ P3 (backend kind + splicer + meta-poll)
                                                └─▶ P4 (Step 0 + LeftRail + step graph)
                                                      ├─▶ P5 (Dim UI: kind picker + 4 builders)
                                                      └─▶ P6 (Segment UI: filter tree + identity)
                                                            └─▶ P7 (Test-run preview per kind + spike)
                                                                  └─▶ P8 (Kind badges everywhere)
```

P5 and P6 are parallelizable after P4 (different builder bodies, same shell). Bring them together at P7.

## Locked Decisions

- **Pre-flight gate (P1 task 0):** Spike `cubejsApi.load({ segments: [...] })` shape against this codebase's `@cubejs-client/core`. Result documented in P1 phase file before P5/P6/P7 UX design lands. ~30 min, no code yet.
- **Write target path resolution:** `metrics-catalogue/cube/model/cubes/<cube>.yml` lives in a **sibling repo** (e.g. `C:\Users\...\code\metrics-catalogue\`), reached via Cube server's `modelDir` mount — NOT under cube-playground's git tree. Acceptance verifies via Cube `/meta` hot-reload, not via grep against cube-playground.
- **SQL template form differs by kind** (see P2 for full table): banding `case.when[].sql`, time-since `sql:`, boolean `sql:` use `{CUBE}.<raw_column>` form (raw column ref — the dim being authored may not exist as a member yet); segment `sql:` reuses `flattenToSql` which emits `{member}` for same-cube or `{cube.member}` for cross-cube member references.
- **Artifact kinds in v1:** measure (existing), dimension (4 sub-kinds: banding / time-since / passthrough / boolean), segment.
- **Step 0 lives before Source.** Single-screen radio + Continue. Switching kind on Step 0 clears kind-specific sub-state with a confirm dialog when sub-state is non-empty (mirrors op-switch behavior).
- **Per-kind step graph.** Measure = 6 steps unchanged. Dimension = Source → Dim kind → Builder → Identity → Test run. Segment = Source → Filter tree (Step 4 component reused) → Identity → Test run.
- **Single polymorphic draft `NewMetricDraftV3`** discriminated by `artifactKind`. Identity + source + persistence shared. Kind-specific sub-state (`dimKind`, `dimBuilder`, `filterTree`) gated by discriminator.
- **YAML emitter** factored as `yaml/generate-cube-entry.ts` dispatcher → `generate-measure.ts` (existing logic) + `generate-dimension.ts` + `generate-segment.ts`. Each generator returns `{ yaml, fragment, sectionKey }`.
- **Backend `/api/playground/schema/write`** body extended with `kind: 'measure'|'dimension'|'segment'` (default `'measure'` for back-compat). `entryName` replaces `measureName`. `vite-plugins/yaml-splice.ts` `splice()` becomes kind-aware; per-kind required-keys: measure=`[name,sql,type]`, dimension=`[name,type]` + (`sql` or `case`), segment=`[name,sql]`.
- **Cross-kind same name allowed.** A `mf_users.whales` segment can coexist with a `mf_users.whales` measure. UX disambiguates via **kind badges** (Measure / Dimension / Segment) on every entry shown in pickers, dropdowns, find-similar warnings, and rails. Within-kind duplicate names still rejected with 400.
- **Per-kind auto-name builder.** banding → `<col>_tier`, time-since → `days_since_<col>` (or `<unit>_since_<col>`), passthrough → `<col>`, boolean → `is_<predicate-slug>`, segment → slug of first predicate (`vn_whales`-style). Measure auto-name unchanged.
- **`meta-poll.ts` `waitForMember`** extended to inspect the correct `/meta` section per kind (measures / dimensions / segments). 15s timeout + `warning: 'meta-not-acknowledged'` fallback unchanged.
- **Segment preview API:** spike during Phase 7 — confirm `cubejsApi.load({ segments: [<qualified>] })` shape against this codebase's `@cubejs-client/core`. Ship cohort-size tile if it works; fall back to SQL-only preview if not. Decision documented at code-time.
- **TDD per phase.** Each phase's first task is a failing test for the contract it implements. No phase-end checkbox without green tests + a brief test-list summary in the phase file.
- **`.bak` per-(entry, kind), not per-file.** Multi-kind writes to the same cube YAML are now possible — single `.bak` with first-write-wins (`schema-file-ops.ts:80-89`) would clobber concurrent work. P3 introduces suffixed backups: `<cube>.yml.<entryName>.<kind>.bak`. `PendingEntry` carries `kind`; `restoreBak` resolves the right backup per-(entry, kind).
- **No `entryName`/`measureName` half-migration.** P3 renames `measureName` → `entryName` in ONE sweep across all 5 call-sites + audit log + WriteBody type. No alias debt.
- **Boolean dim predicate is FilterLeaf-shaped (generator-enforced, not just UI).** `generate-dimension.ts` for `boolean` kind rejects raw SQL with `;`, control bytes, or unquoted values. Reuses `flattenToSql`'s value-sanitization path.
- **localStorage migration:** `STORAGE_VERSION` bumps from 2 → 3. P1 adds `migrateLegacyShape(v2 → v3)` that injects `artifactKind: 'measure'` for persisted V2 drafts. Existing in-flight drafts hydrate cleanly.

## Total Effort

≈ 7.25 focused days. Calendar ~1.5–2 weeks.

| Phase | Effort | Priority |
|-------|--------|----------|
| P1 | 0.75d (was 0.5d — adds pre-flight spike, V2→V3 migration, ref-reset, auto-name collision suffix) | P0 (gate) |
| P2 | 1d | P1 |
| P3 | 1d (was 0.75d — adds per-kind .bak, single-sweep entryName rename) | P1 |
| P4 | 0.75d | P1 |
| P5 | 2d (was 1.5d — realistic with 4 builders + tests + 4 manual smokes + boolean-predicate generator check) | P1 |
| P6 | 0.5d | P1 |
| P7 | 1d | P2 |
| P8 | 0.75d (was 0.5d — useReachableMembers split + cross-kind similarity rule) | P2 |

## Dependencies

- **Builds on:** [`260517-1500-new-metric-fullpage-6step-rebuild`](../260517-1500-new-metric-fullpage-6step-rebuild/plan.md) — provides the full-page 6-step shell (`NewMetricPage.tsx`, LeftRail, StepChrome), the v2 emitter, the `/api/playground/schema/write` endpoint, the filter tree, and the test-run lifecycle this plan extends.
- **Orthogonal to:** [`260517-1930-new-metric-multi-source-multi-input`](../260517-1930-new-metric-multi-source-multi-input/plan.md) — multi-source / N-slot inputs touch measure-mode Step 1/2/3 only. Either plan can ship independently; if multi-source lands first, the measure-branch step graph absorbs its changes automatically (dim + segment graphs are unaffected).
- **Reads from research:** [`research-260517-measures-dimensions-segments-mental-model.md`](../reports/research-260517-measures-dimensions-segments-mental-model.md), [`research-260517-metric-creation-types-roadmap.md`](../reports/research-260517-metric-creation-types-roadmap.md).

## Out of Scope

- Cross-cube dimension composition (dim referencing column of joined cube).
- Segment composition (named-segment-of-segments).
- Parameterized dims/segments (Cube `parameters:`).
- Edit / re-author existing measure, dim, or segment (v1 only creates new).
- Cohort snapshot / past-segment carryover (Tier 3.4 in roadmap; needs upstream snapshot writer).
- Rolling window, time-shift, cumulative, calendar-window measures (Tier 2 in roadmap — separate plan).
- Conversion / retention metrics (Tier 3.2 / 3.3 in roadmap).

## Acceptance Criteria

1. From Step 0, user can pick Dimension or Segment and complete the wizard end-to-end with the new YAML entry landing under the correct top-level key in `metrics-catalogue/cube/model/cubes/<cube>.yml`.
2. Cube `/meta` reflects the new entry within the existing 15s poll budget; Step 6 status transitions writing → success.
3. Live preview shows: measure → scalar+sparkline (no regression); dimension → top-N distribution table; segment → cohort-size tile (or SQL-only fallback if API spike fails).
4. Discard restores `.bak` for all three kinds.
5. YAML preview rail header reflects the entry's section (`measures:` / `dimensions:` / `segments:`).
6. Per-kind auto-name fills Name on first column/builder selection and stays auto until user types.
7. Kind badges visible on every entry shown in pickers, dropdowns, and find-similar warnings.
8. Measure-mode flow byte-identical to today (no regression on existing 6-step UX).
9. Within-kind duplicate name → 400 with clear message. Cross-kind same name → allowed.
10. All new TDD tests green; existing measure-mode test suite untouched + still green.
11. Pre-flight spike completed and result documented in P1 phase file before P5/P6/P7 UX design starts.
12. localStorage V2→V3 migration covered by tests; persisted V2 drafts hydrate with `artifactKind: 'measure'` and no field loss.
13. `.bak` rollback is per-(entry, kind); concurrent multi-kind writes to the same cube file do not corrupt each other's rollback.
14. Boolean predicate generator rejects raw SQL containing `;`, control bytes, or unquoted values.

## Open Questions

1. **Banding `else:` label** — require non-empty or allow omission (Cube returns NULL when missing)? Default: require for clarity, force the user to pick a fall-through label. Confirm at P5 implementation.
2. **Time-since reference timestamp** — hard-code `CURRENT_DATE` in v1 to match existing dims, or expose an "as of" picker? Default: hard-code; revisit if a campaign needs runtime override.
3. **Kind-badge styling** — short pill (`M` / `D` / `S`) vs full word vs icon. Cosmetic; decide at P8.
4. **Segment preview cohort baseline** — show absolute count only, or also % share of cube's total `count_distinct(user_id)`? Default: both if available, fall back to count-only if the baseline query is expensive. Verify at P7 spike.
5. **Auto-name slug from segment predicate** — what's the rule for predicates with multiple leaves (`country='VN' AND ltv>=10M`)? Default: concatenate stable tokens (`vn_whales`-style) up to 24 chars. Confirm at P1.

## Related Reports

- Brainstorm: [`../reports/brainstorm-260517-extend-new-metric-authorize-dims-segments.md`](../reports/brainstorm-260517-extend-new-metric-authorize-dims-segments.md)
- Research: [`../reports/research-260517-measures-dimensions-segments-mental-model.md`](../reports/research-260517-measures-dimensions-segments-mental-model.md), [`../reports/research-260517-metric-creation-types-roadmap.md`](../reports/research-260517-metric-creation-types-roadmap.md)

## Red Team Review

### Session 1 — 2026-05-17
**Findings:** 40 raw → 21 unique after dedup → 15 accepted, 6 rejected
**Severity breakdown (accepted):** 6 Critical, 6 High, 3 Medium
**Reviewers:** Security Adversary (Fact Checker), Failure Mode Analyst (Flow Tracer), Assumption Destroyer (Scope Auditor), Scope & Complexity Critic (Contract Verifier)
**Disposition summary:** 15 factual findings Accepted (all applied) + 6 user-confirmed-scope reversals Rejected (Step 0 + 4 dim sub-kinds + KindBadge ubiquity user-chosen in brainstorm)

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | `mf_users.yml` "phantom fixture" | Critical | **Reject** | File exists in sibling repo via Cube modelDir mount (verified). Plan.md "Locked Decisions" now clarifies path resolution. |
| 2 | `{member}` vs `{CUBE}.col` template form ambiguity | Critical | Accept | plan.md Locked Decisions + Phase 2 |
| 3 | `meta-poll waitForMember` throws on timeout, not returns null | Critical | Accept | Phase 3 |
| 4 | `.bak` first-write-wins race across multi-kind writes | Critical | Accept | plan.md Locked Decisions + Phase 3 |
| 5 | Boolean predicate free-text SQL bypasses sanitization | Critical | Accept | plan.md Locked Decisions + Phase 5 |
| 6 | localStorage V2→V3 migration missing | Critical | Accept | plan.md Locked Decisions + Phase 1 |
| 7 | Reserved-name + cross-kind scope clarification | High | Accept | Phase 3 |
| 8 | `useReachableMembers` extension semantically wrong | High | Accept | Phase 8 (split into two hooks) |
| 9 | `useFindSimilar` cross-kind matching rule undefined | High | Accept | Phase 8 |
| 10 | `filterTree` shared between measure-filters & segment-cohort | High | Accept | Phase 1 reducer |
| 11 | `entryName`/`measureName` half-migration | High | Accept | plan.md Locked Decisions + Phase 3 |
| 12 | `lastAutoNameRef` not reset on `artifactKind` change | High | Accept | Phase 4 |
| 13 | P5 1.5d budget unrealistic | Medium | Accept | plan.md effort table (1.5d → 2d) |
| 14 | P7 segment API spike should be P0 prerequisite | Medium | Accept | plan.md Locked Decisions + Phase 1 task 0 |
| 15 | Auto-name slug truncation collisions silent | Medium | Accept | Phase 1 (collision check + suffix) |
| — | "8 phases over-engineered" | (YAGNI) | **Reject** | User-confirmed smooth per-kind UX in brainstorm |
| — | "4 dim sub-kinds gold-plating" | (YAGNI) | **Reject** | User-confirmed all 4 sub-kinds in brainstorm |
| — | "Step 0 vs ?kind= URL param" | (YAGNI) | **Reject** | User-confirmed Step 0 toggle in brainstorm |
| — | "KindBadge ubiquity scope creep" | (YAGNI) | **Reject** | User-confirmed cross-kind same-name + badge disambiguation in brainstorm |
| — | "Banding `label:` vs `then:` schema wrong" | (factual) | **Reject** | Verified at mf_users.yml:151-160 — `label:` is correct schema for this codebase |
| — | "`count_segments` reserved-name theory" | (factual) | **Reject** | RESERVED_NAMES checks exact match only; `count_segments` is not reserved |

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 through phase-08
- Decision deltas checked: 15 (mf_users.yml path resolution, segment template form vs banding template form, meta-poll throws-not-returns, per-kind .bak, boolean generator sanitization, V2→V3 migration, per-section duplicate scan, useReachableMembers split, find-similar rule, filterTree clear on segment→other switch, single-sweep entryName rename, lastAutoNameRef reset, P5 effort bump, pre-flight spike, auto-name collision suffix)
- Reconciled stale references: 0 (no rejected-decision residue — accepted findings only extended existing sections)
- Unresolved contradictions: 0
