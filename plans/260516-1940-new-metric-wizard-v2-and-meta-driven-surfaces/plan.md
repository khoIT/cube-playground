---
title: "New Metric Wizard v2 + Meta-Driven Surfaces — SUPERSEDED by 260517-1500"
description: "SUPERSEDED 2026-05-17 by `260517-1500-new-metric-fullpage-6step-rebuild` (full-page 6-step rebuild replaces the 3-step modal). P1 (extended /meta) + P2 (YAML emitter + draft state) salvaged into that plan's Phase 1. Remaining phases (P3–P8) dropped or deferred to separate plans."
status: cancelled
priority: P2
branch: "main"
tags: [feature, wizard, tags, meta, catalog, sidebar, live-preview, poc, superseded]
blockedBy: [260517-1500-new-metric-fullpage-6step-rebuild]
blocks: []
created: "2026-05-16T12:12:54.438Z"
cancelled: "2026-05-17T15:00:00.000Z"
cancelledReason: "Direction changed to full-page 6-step flow per brainstorm-260517-new-metric-fullpage-6step-rebuild.md"
createdBy: "ck:plan"
source: skill
---

> **⚠️ Cancelled 2026-05-17** — superseded by [`../260517-1500-new-metric-fullpage-6step-rebuild/plan.md`](../260517-1500-new-metric-fullpage-6step-rebuild/plan.md). P1 (extended meta) + P2 (YAML emitter + draft state) salvaged into the new plan's Phase 1. Original plan kept for history.

# New Metric Wizard v2 + Meta-Driven Surfaces

## Overview

Two strands merged into one cohesive plan:

1. **Wizard redesign** (from brainstorm [`../reports/brainstorm-260516-1940-new-metric-redesign-tags-live-preview.md`](../reports/brainstorm-260516-1940-new-metric-redesign-tags-live-preview.md)) — replace the current single-pane Dialog (`src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx`) with a 3-step focused stepper modal (Define → Identify → Preview) matching the `New Metric Flow _standalone_.html` mockup. Add tags as first-class measure metadata, replace dry-run SQL with commit-then-preview live preview (scalar + 7d sparkline), add tag-filter chips to the QueryBuilder sidebar.

2. **Meta-driven surfaces** (absorbed from cancelled plan `260516-1700-meta-driven-product-surfaces`) — wire `/cubejs-api/v1/meta?extended=true` into multiple product layers: fix `cubeApi.meta()` to use `extended=true` (unblocks `joins[]` and reachability), surface description/aggType/format in sidebar tooltips, add cube cluster badges, emit provenance `meta:` block from the wizard, add find-similar warning, build a standalone `/catalog` browse view, enable pre-aggregations + show badge.

Both strands touch the same files (NewMetricDialog, sidebar measure list, schema-write middleware) and the same data source (`/meta`). Shipping them in one plan avoids merge pain. POC-grade scope — demo against ballistar_vn (4 cubes + 7 views). No PROD guard, no new env vars, provenance author hardcoded `khoitn`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Foundation extended meta and reachability fix](./phase-01-foundation-extended-meta-and-reachability-fix.md) | Pending |
| 2 | [Draft state and YAML generator extensions](./phase-02-draft-state-and-yaml-generator-extensions.md) | Pending |
| 3 | [Wizard shell redesign 3-step stepper](./phase-03-wizard-shell-redesign-3-step-stepper.md) | Pending |
| 4 | [Identify step tag combo and find-similar](./phase-04-identify-step-tag-combo-and-find-similar.md) | Pending |
| 5 | [Live preview scalar sparkline and discard](./phase-05-live-preview-scalar-sparkline-and-discard.md) | Pending |
| 6 | [Sidebar enrichment tooltip cluster badge tag chips](./phase-06-sidebar-enrichment-tooltip-cluster-badge-tag-chips.md) | Pending |
| 7 | [Catalog browse view standalone route](./phase-07-catalog-browse-view-standalone-route.md) | Pending |
| 8 | [Pre-aggregation enablement and badge](./phase-08-pre-aggregation-enablement-and-badge.md) | Pending |

## Sequence

```
P1 (gate, P0) ──┬─▶ P2 (state + YAML) ──▶ P3 (stepper shell) ──┬─▶ P4 (identify step + find-similar)
                │                                                └─▶ P5 (live preview)
                │
                └─▶ P6 (sidebar enrichment) ──▶ P7 (catalog) ──▶ P8 (pre-agg badge)

P1 must land first (fixes reachability bug affecting P3-P5 and P6-P7).
P4 + P5 parallelizable after P3.
P6 parallelizable with P3-P5 (different files).
P7 depends on P1; can start once P1 is in.
P8 depends on P7 (badge surface) + cube YAML edit.
```

## Key Decisions (locked)

- **Wizard layout:** 3-step focused stepper modal. Brand orange `#f05a22` active, dark `#0a0a0a` canvas. Right rail (~360px) = persistent YAML preview + live preview on step 3.
- **Step grouping:** Define (Source + Op + Of + Filter) → Identify (Name + Title + Description + Tags + Format) → Preview (time dim + scalar + sparkline + Define/Discard).
- **Tags:** stored as `meta: { tags: [...] }` per measure (Cube-native). Combo picker (existing suggestions + free-form). Sidebar filter chips above measures, multi-select union, URL-param persisted.
- **Live preview:** commit-then-preview (Option A from brainstorm). Writes YAML on step-3 entry, polls `/meta`, runs `/load`. Explicit Discard button restores `.bak` (requires confirm dialog). Scalar-only fallback when source cube has no time dimension.
- **Meta endpoint:** `/cubejs-api/v1/meta?extended=true` ONLY. Reuses existing `AppContext.cubejsToken`. No `/cubejs-system/*`, no PROD guard.
- **Provenance:** every wizard-authored measure emits `meta: { source: 'wizard', author: 'khoitn', created_at: <ISO>, tags: [...] }`. Hand-authored YAML not retroactively stamped.
- **Find-similar match:** `aggType + sourceCube` (loose match; `measure.sql` is security-stripped per Cube design — exact column-overlap check impossible).
- **Catalog auth:** identical to QueryBuilder. No PROD guard. Author hardcoded `khoitn`.
- **Out-of-wizard scope additions:** /catalog page + pre-agg badge fully shipped (no dev-only guard).

## Total Effort

≈ 8-10 focused days. Calendar 2-3 weeks.

| Phase | Effort | Priority |
|-------|--------|----------|
| P1 | 0.5d | P0 (gate) |
| P2 | 0.5d | P1 |
| P3 | 1.5d | P1 |
| P4 | 1d   | P2 |
| P5 | 1.5d | P2 |
| P6 | 1d   | P2 |
| P7 | 2-3d | P2 |
| P8 | 1d   | P3 |

## Dependencies

Supersedes the cancelled plan `260516-1700-meta-driven-product-surfaces` (rolled in its 5 phases). Builds on the completed `260516-1530-define-metric-wizard` (v1 wizard shipped 8468b8a).

P8 touches `metrics-catalogue/cube/model/cubes/mf_users.yml` — coordinate that change with the metrics-catalogue repo separately.

## Out of Scope (this plan)

- Editing tags on existing measures (new-metric flow only)
- Tag rename / merge / canonicalization tooling
- Backfilling `meta:` provenance on hand-authored measures (wizard-only)
- Tagging dimensions (measures only — Cube semantics)
- Server-side tag dedup or validation
- Permissions / tag ownership
- Lineage view (cube → upstream tables) — needs YAML read access not in `/meta`
- Hidden-member discovery beyond PK dimensions
- SQL snippet display per measure — `/meta` never exposes
- Hygiene docs-coverage % leaderboard
- Catalog virtualisation / scale beyond ~50 cubes
- Multi-game scope (single-game `ballistar_vn`)

## Open Questions

1. Does `?extended=true` populate `preAggregations` reliably in `/meta` on the deployed Cube version? Re-probe at start of P8.
2. Should find-similar (P4) consider cross-cube measures? Default: same source cube only (less noise, demo-clearer).
3. Catalog DetailPanel "Open in Playground" — pre-select first measure or just set source cube? Default: source cube only.

## Related Reports

- Brainstorm: [`../reports/brainstorm-260516-1940-new-metric-redesign-tags-live-preview.md`](../reports/brainstorm-260516-1940-new-metric-redesign-tags-live-preview.md)
- Source brainstorm (cancelled meta-driven plan): [`../reports/metadata-catalog-tab-system-meta.md`](../reports/metadata-catalog-tab-system-meta.md)
- Architecture: [`../reports/architecture/cube-vs-cdp-metrics-architecture.md`](../reports/architecture/cube-vs-cdp-metrics-architecture.md), [`../reports/architecture/cube-mm01-integration-and-schema-reload.md`](../reports/architecture/cube-mm01-integration-and-schema-reload.md), [`../reports/architecture/poc-scoping-and-leadership-decisions.md`](../reports/architecture/poc-scoping-and-leadership-decisions.md)

## Validation Log

### Session 1 — 2026-05-16

**Trigger:** `/ck:plan validate plans/260516-1940-new-metric-wizard-v2-and-meta-driven-surfaces`
**Tier:** Full (8 phases → all 4 verification roles)
**Questions asked:** 4

#### Verification Results

- **Claims checked:** 13
- **Verified:** 10
- **Failed:** 1
- **Unverified:** 2

**Verified (10):**
- All cited file paths exist: `query-builder.ts`, `generate-measure-yaml.ts`, `types.ts`, `schema-write-handler.ts`, `schema-file-ops.ts`, `meta-poll.ts`, `yaml-splice.ts`, `Header.tsx`, `App.tsx`, `tokens.css`
- `loadMeta` + `.meta()` SDK call confirmed at `src/QueryBuilderV2/hooks/query-builder.ts:322,332` — Phase 1 target verified
- `useReachableMembers` reads `cube.joins` at `use-reachable-members.ts:42,44` — Phase 1 premise verified
- `writeBak` is unconditional at `schema-file-ops.ts:70` — Phase 5 `.bak` clobber risk **confirmed**
- `connectedComponent` is already read at `query-builder.ts:1095-1106` — Phase 1 may already work without `?extended=true` for this field; Phase 1 added Step 0 probe
- `--brand`, `--bg-card`, `--border-card` CSS tokens exist in `tokens.css:29-35` — Phase 3 token claim verified
- `aggType` field used in test fixture at `use-reachable-members.test.ts:31` — Phase 4 + 6 agg-type chip assumption verified
- `react-router-dom@5.3.4` confirmed in `package.json:50` — Phase 7 router shape known (Switch + Route v5 paradigm)
- `waitForMember` at `meta-poll.ts:41` — Phase 5 dependency verified
- Existing tooltip plumbing: `InstanceTooltipProvider.tsx` — Phase 6 can reuse

**Failed (1):**
- [Fact Checker] Phase 6 cited `src/QueryBuilderV2/sidebar/` — directory does not exist. Actual: components live in `src/QueryBuilderV2/components/`. Sidebar entrypoint at `QueryBuilderV2/QueryBuilderSidePanel.tsx`. **Resolved in interview Q1.**

**Unverified (2):**
- ui-kit `Tooltip` / `Drawer` exports — `node_modules` access blocked by scout-block hook. Defer to implementation-time check; fall back to ui-kit primitive (Popover / custom div with portal) if absent.
- Cube `/meta?extended=true` actual payload shape (`preAggregations` populated?). Phase 1 Step 0 probe + Phase 8 Step 1 probe handle this empirically.

**Stale claim removed:**
- Phase 3 success criterion "No `tasty('tag', ...)` invocations remain" — already fixed in commit 8468b8a (zero grep matches). Dropped from Phase 3.

#### Questions & Answers

1. **[Fact Checker / Path]** Phase 6 cites `src/QueryBuilderV2/sidebar/` for new sidebar files — but that directory doesn't exist. Existing sidebar files live in `src/QueryBuilderV2/components/`. Where should the new files go?
   - Options: Add to components/ (Recommended) | New sidebar/ subdir for new files only | Create sidebar/ AND move existing
   - **Answer:** Add to `src/QueryBuilderV2/components/` (matches convention)
   - **Rationale:** Sticks with existing convention; no new directory; less churn.

2. **[Architecture / Risks]** Phase 5 commit-then-preview will clobber `.bak` on every debounced re-run because `writeBak` is unconditional. How should we preserve the true original?
   - Options: First-write-wins guard (Recommended) | Wizard-session backup name | No file backup
   - **Answer:** Write `.bak` only if it does NOT already exist (first-write-wins)
   - **Rationale:** Smallest middleware change; true pre-wizard original preserved across debounced re-runs; Discard recovers genuine pre-edit state.

3. **[Risks / Architecture]** Phase 5 race: rapid measure-name changes cause orphan YAML entries. How to handle?
   - Options: Auto-Discard prior on name change (Recommended) | Lock name once step 3 entered | Allow drift
   - **Answer:** Auto-Discard the prior measure on name change
   - **Rationale:** Keeps file clean; debounce mitigates extra round-trips; preserves user flexibility to tweak the name.

4. **[Scope / Architecture]** Phase 7 `Open in Playground` requires `?cube=` URL handling, which doesn't exist today. What scope?
   - Options: Add `?cube=` reader to QueryBuilder root (Recommended) | AppContext setter from Catalog | Drop the button
   - **Answer:** Add small `?cube=` reader to QueryBuilder root
   - **Rationale:** ~10 lines; reusable for future deep-links; doesn't couple Catalog to QueryBuilder internals.

#### Confirmed Decisions

- Phase 6 new sidebar files in `src/QueryBuilderV2/components/` (not `sidebar/`)
- Phase 5 `writeBak` first-write-wins guard added to Implementation Step 1
- Phase 5 `useLivePreview` tracks `lastWritten` and auto-fires `deleteSchemaWrite(prior)` before writing new name
- Phase 7 adds `?cube=` URL reader to `src/QueryBuilderV2/QueryBuilder.tsx` on mount
- Phase 1 prepended Step 0 probe (curl /meta before changing code)
- Phase 3 dropped stale `tasty('tag', ...)` success criterion

#### Action Items

- [x] Phase 6 file paths corrected (sidebar/ → components/, hooks/ stays in QueryBuilderV2/hooks/)
- [x] Phase 6 Step 1 reflects already-scouted file structure
- [x] Phase 5 Step 1 patches `writeBak` first-write-wins
- [x] Phase 5 `useLivePreview` adds `lastWritten` ref + auto-Discard sequencing
- [x] Phase 5 Risk Assessment marks both prior risks as RESOLVED
- [x] Phase 7 OpenInPlayground spec specifies `?cube=` reader in QueryBuilder.tsx
- [x] Phase 7 Related Files lists QueryBuilder.tsx as modified
- [x] Phase 3 dropped stale `tasty('tag', ...)` criterion
- [x] Phase 1 prepended runtime probe step

#### Impact on Phases

- **Phase 1:** Probe step added; framing acknowledges `connectedComponent` may already be exposed.
- **Phase 3:** Success criterion list shortened (stale item removed).
- **Phase 5:** Implementation Steps renumbered (10 steps now); Risk Assessment notes 2 resolutions; `schema-file-ops.ts` added to modified files; `useLivePreview` state machine extended with `'discarding-prior'`.
- **Phase 6:** All file paths corrected to `src/QueryBuilderV2/components/` + `src/QueryBuilderV2/hooks/`; Step 1 acknowledges already-scouted structure.
- **Phase 7:** OpenInPlayground spec made concrete; `QueryBuilder.tsx` added to modify list.

### Whole-Plan Consistency Sweep

- **Files reread:** plan.md, phase-01, phase-02, phase-03, phase-04, phase-05, phase-06, phase-07, phase-08
- **Decision deltas checked:** 5 (sidebar paths, .bak strategy, name-change race, ?cube= deep-link, stale tasty criterion)
- **Reconciled stale references:** Phase 6 paths (8 occurrences). Phase 3 stale criterion. Phase 5 implementation step numbering. Phase 7 deep-link spec.
- **Unresolved contradictions:** 0
- **Stale terms checked:** "sidebar/", "tasty('tag'", "writeBak clobber" — all resolved or removed.

**Recommendation:** Proceed to `/ck:cook`. Plan is internally consistent; no contradictions remain.

