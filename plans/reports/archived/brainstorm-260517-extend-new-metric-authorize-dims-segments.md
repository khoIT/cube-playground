# Brainstorm — Extend New-Metric Flow to Author Dimensions and Segments

**Date:** 2026-05-17
**Companion:** [`research-260517-measures-dimensions-segments-mental-model.md`](./research-260517-measures-dimensions-segments-mental-model.md), [`research-260517-metric-creation-types-roadmap.md`](./research-260517-metric-creation-types-roadmap.md)
**Status:** Brainstorm closed — design approved by user, awaiting plan handoff.

## TL;DR

Wizard today writes only `measures:` entries. Extend it to also write `dimensions:` (banding / time-since / passthrough / boolean) and `segments:` into the same cube YAML, via a Step 0 artifact-kind toggle + per-kind step graph + dispatcher emitter + the existing `/api/playground/schema/write` endpoint extended with a `kind` discriminator. Goal: dim + segment authoring feels as smooth as the current measure flow.

## Problem statement

`metrics-catalogue/cube/model/cubes/*.yml` declares three artifact types per cube (measures, dimensions, segments), all of which liveops 2026 campaigns read from User Stage. The wizard (`src/QueryBuilderV2/NewMetric/full-page`) authors only measures. Hand-rolling dims and segments in YAML is the current path — error-prone, no live preview, drifts across campaigns.

## Decisions (confirmed)

| # | Decision | Choice |
|---|---|---|
| 1 | Artifact scope | Both dimensions + segments in v1 |
| 2 | Dimension kinds | banding (case when/else), time-since (DATE_DIFF), passthrough, boolean predicate |
| 3 | Entry UX | Step 0 artifact-kind toggle before Source |
| 4 | Step shape | Per-kind step graph (measure 6-step unchanged, dim 5-step, segment 4-step) |
| 5 | Write target | Splice into same cube YAML (extend yaml-splice.ts + existing endpoint) |
| 6 | Acceptance | End-to-end YAML write, per-kind live preview, .bak rollback, YAML preview rail per kind, kind-badge disambiguation |
| 7 | Auto-name | Per-kind builder (parity with measure mode) |
| 8 | Segment preview API | Spike during implementation; ship live preview if `cubejsApi.load({ segments })` works, fall back to SQL-only otherwise |
| 9 | Meta-poll | Extended to look in correct `/meta` section per kind |
| 10 | Name collision | Same names allowed across kinds; UX disambiguates via Measure / Dimension / Segment badge |

## Out of scope (v1)

- Cross-cube dimension composition
- Segment-of-segments composition
- Cube `parameters:` (parameterized SQL)
- Edit / re-author existing dim or segment (only new entries)

## Design

### A. Draft model

```ts
type ArtifactKind = 'measure' | 'dimension' | 'segment';
type DimKind = 'banding' | 'time-since' | 'passthrough' | 'boolean';

type NewMetricDraftV3 = {
  artifactKind: ArtifactKind;        // drives step graph + emitter
  sourceCubes: string[];

  // Measure branch (existing, untouched)
  operation: Operation;
  inputs: Record<string, string | null>;

  // Dimension branch (new)
  dimKind?: DimKind;
  dimBuilder?:
    | { kind: 'banding'; column: string; bands: Array<{ sql: string; label: string }>; else: string }
    | { kind: 'time-since'; timeColumn: string; unit: 'day' | 'hour' | 'month' }
    | { kind: 'passthrough'; column: string; outputType: 'string'|'number'|'boolean'|'time' }
    | { kind: 'boolean'; predicate: string };

  // Segment branch (new) — reuses FilterGroup
  filterTree: FilterGroup;           // already exists in filter-tree/

  // Shared identity + meta
  name; title; description; format; tags; grain; visibility; previewTimeDimension; previewRange;
};
```

Single polymorphic draft (not three types). Identity + source + persistence shared. Switching artifactKind on Step 0 clears kind-specific sub-state — same pattern as op-switch clears `inputs`.

### B. Step graph per kind

| Kind | Step graph |
|---|---|
| measure | Source → Operation → Column → Filters → Identity → Test run (current 6, unchanged) |
| dimension | Source → Dim kind picker → Builder body → Identity → Test run |
| segment | Source → Filter tree (reuses Step 4 component) → Identity → Test run |

LeftRail chip count varies per kind. Step 0 (artifact picker) sits before Source — single-screen radio + Continue.

### C. YAML emitter

Rename `yaml/generate-measure-yaml.ts` → `yaml/generate-cube-entry.ts`, dispatcher:

```ts
generateEntry(draft, ctx): { yaml; fragment; sectionKey: 'measures'|'dimensions'|'segments' }
```

Split into:
- `generate-measure.ts` — existing logic factored out.
- `generate-dimension.ts`:
  - banding → `case: { when: [{sql, label}, …], else: { label } }`
  - time-since → `sql: DATE_DIFF('<unit>', {col}, CURRENT_DATE), type: number`
  - passthrough → `sql: <col>, type: <typed>`
  - boolean → `sql: CASE WHEN <pred> THEN TRUE ELSE FALSE END, type: boolean`
- `generate-segment.ts` — reuses `flattenToSql(filterTree, sourceCube)` from `filter-tree/flatten-to-sql.ts`. Emits `{ name, sql, description? }`.

`meta: { source: 'wizard', author, created_at, grain, visibility, tags }` block shared across kinds.

Auto-name builder per kind:
- banding → `<col>_tier`
- time-since → `days_since_<col>` (or `<unit>_since_<col>`)
- passthrough → `<col>`
- boolean → `is_<predicate-slug>`
- segment → slug of first predicate (e.g. `country='VN'` + `ltv >= 10M` → `vn_whales`)

### D. Backend write

`/api/playground/schema/write` body extended:

```ts
{ cubeName, entryName, kind: 'measure'|'dimension'|'segment', yamlPatch }
```

Default `kind: 'measure'` for back-compat. Same `.tmp` → mtime-guard → `.bak` → atomic rename → meta-poll sequence — kind-agnostic.

`vite-plugins/yaml-splice.ts` `splice()` signature: `(input, cubeName, entryName, kind, yamlPatch)`. Required keys per kind:
- measure: `[name, sql, type]` (current)
- dimension: `[name, type]` plus one of `[sql]` or `[case]`
- segment: `[name, sql]`

`RESERVED_NAMES` stays as-is (blocks `name: measures`, `name: dimensions`, etc. as entry names).

Within-kind duplicate check stays. Cross-kind same-name allowed.

`waitForMember` in `vite-plugins/meta-poll.ts` extended to inspect the correct `/meta` section per kind.

`api.ts` `postSchemaWrite` / `deleteSchemaWrite` gain `kind` arg, defaulting to `'measure'`.

### E. Test-run preview per kind

`use-test-run.ts` write-then-query, dispatched by kind:

| Kind | Post-write query |
|---|---|
| measure | `load({ measures: [qualified] })` — scalar + sparkline. Unchanged. |
| dimension | `load({ dimensions: [qualified], measures: [<cube>.<count_measure>], limit: 25, order: desc })` — top-N distribution table. |
| segment | Spike: `load({ measures: [<cube>.<count>], segments: [qualified] })` for cohort size + a no-segment baseline for share %. If API shape differs, fall back to SQL-only preview. Decision lands during implementation. |

Write + `.bak` rollback machinery unchanged. Only the post-write query differs.

### F. UX disambiguation — kind badges

Same name allowed across kinds (e.g. `mf_users.whales` segment can coexist with `mf_users.whales` measure if a user picks it). UI disambiguates everywhere entries appear:

- Step 3 column picker (measure mode) — badge per row
- Filter tree column dropdown (Step 4 / segment-mode body) — badge per row
- `find-similar-warning` — show kind of similar entry
- YAML preview rail — header reflects the entry's section (`measures:` / `dimensions:` / `segments:`)
- Identity step right rail — kind chip near the name field

Tag styling: small uppercase pill — `M` / `D` / `S` or full word `Measure` / `Dimension` / `Segment`. Picks land at implementation time.

## Touchpoints (files)

**Frontend:**
- `src/QueryBuilderV2/NewMetric/types.ts` — `NewMetricDraftV3`, `ArtifactKind`, `DimKind`
- `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — Step 0 + per-kind renderStep dispatch
- `src/QueryBuilderV2/NewMetric/full-page/shell/left-rail.tsx` — per-kind chip list
- `src/QueryBuilderV2/NewMetric/full-page/hooks/use-active-step.ts` — per-kind step graph
- `src/QueryBuilderV2/NewMetric/full-page/hooks/compute-auto-metric-name.ts` — per-kind auto-name
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-0-artifact-kind/` (new dir)
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-kind/` (new dir)
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-builder/` (new dir — 4 sub-bodies: banding, time-since, passthrough, boolean)
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/use-test-run.ts` — per-kind preview shape
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/yaml-preview-rail.tsx` — section-key-driven header
- `src/QueryBuilderV2/NewMetric/yaml/generate-cube-entry.ts` (rename of generate-measure-yaml.ts) + `generate-measure.ts` + `generate-dimension.ts` + `generate-segment.ts`
- `src/QueryBuilderV2/NewMetric/api.ts` — `kind` field on write/delete bodies
- Kind-badge component (new, small) — used by pickers, find-similar, rails

**Backend:**
- `vite-plugins/yaml-splice.ts` — `kind` arg, per-kind splice into dimensions[] / segments[]
- `vite-plugins/schema-write-validator.ts` — per-kind required-keys validation
- `vite-plugins/schema-write-handler.ts` — pass `kind` through
- `vite-plugins/meta-poll.ts` — `waitForMember` looks in section matching kind

## Acceptance criteria

1. From Step 0, user can pick Dimension or Segment and complete the wizard end-to-end with the new YAML entry landing under the correct top-level key in `metrics-catalogue/cube/model/cubes/<cube>.yml`.
2. Cube `/meta` reflects the new entry within the existing 15s poll budget; Step 6 status transitions from "writing" → "success".
3. Live preview shows: measure → scalar+sparkline (no regression); dimension → top-N distribution table; segment → cohort-size tile (or SQL-only fallback if API spike fails).
4. Discard restores `.bak` for all three kinds.
5. YAML preview rail renders the correct section header (`measures:` / `dimensions:` / `segments:`) per kind.
6. Per-kind auto-name fills the Name field on first column/builder selection and stays auto until user types.
7. Kind badges visible on every entry shown in pickers, dropdowns, and find-similar warnings.
8. Measure-mode flow byte-identical to today (no regression on existing 6-step UX).
9. Within-kind duplicate name → 400 with clear message. Cross-kind same name → allowed.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Segment preview API shape mismatch | Spike first task in test-run subphase. Fallback to SQL-only preview. Decision documented at code-time. |
| YAML key ordering drift after splice | `yaml.dump` with `sortKeys: false` already used. Keep current stable-order entries pattern in emitters. |
| Hook order regression in `NewMetricPage.tsx` | Existing rule (commit `1edc783`) enforced: all kind-conditional hooks live before the `!isV2` early-return. |
| Dimension builder for `case:` produces malformed Cube YAML | Lift band-builder validation: every band needs non-empty `sql` and `label`; `else` required; emit-time round-trip test (parse → dump → parse). |
| Step 0 reset clears in-progress work on accidental click | Confirm dialog if any kind-specific sub-state is non-empty before switching. Mirrors existing op-switch behavior. |
| Backend `meta-poll` for dims/segments may have different polling lag | Keep 15s timeout policy: on timeout, return 200 with `warning: 'meta-not-acknowledged'` (current behavior). User can refresh. |

## Unresolved questions

- Kind-badge styling — short pill (`M` / `D` / `S`) vs full word vs icon. Defer to UI implementation; cosmetic only.
- Should banding's "else" label be required or have a default? Cube allows omitting `else:` (returns NULL). Recommendation: require an else label for clarity, force user choice. Confirm at implementation.
- Time-since dimension's reference timestamp: today's examples all hard-code `CURRENT_DATE`. Should v1 expose an "as of" picker, or keep hard-coded? Default: hard-code `CURRENT_DATE` in v1 to match existing dims.
