# New Metric Wizard v2 — Redesign with Tags & Live Preview

Date: 2026-05-16
Type: Brainstorm / Design Doc
Status: Approved — ready for `/ck:plan`

## Problem Statement

Current New Metric wizard (`src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx`) is a single-pane fullscreen Dialog with 5 stacked sections (Source → Operation → Of → Filter → Identity) and a right pane showing live YAML + dry-run SQL. Two gaps vs the proposed v2:

1. No first-class **tags** on measures — no input, no storage, no downstream filtering.
2. Preview is **dry-run SQL only** (string) — no actual data shown to user before commit.

The "New Metric Flow (standalone)" mockup in Downloads shows a 3-step focused stepper modal with a contextual right rail. Brand: orange `#f05a22` on dark canvas `#0a0a0a`.

## Requirements (confirmed)

- **Expected output:** 3-step stepper wizard replacing current single-pane Dialog; tags as first-class measure metadata; live preview replacing dry-run SQL; tag-filter chips in QueryBuilder sidebar.
- **Acceptance criteria:**
  - User can step through Define → Identify → Preview with per-step validation.
  - Tags input is a combo picker (existing suggestions + free-form create).
  - Preview shows a real scalar (and 7d sparkline when a time dim is available) using Cube `/load` against the new measure.
  - QueryBuilder sidebar shows tag chips above the measure list; clicking filters the measure list to selected tag union.
  - Discard button on step 3 restores `.bak` (requires confirm).
- **Scope boundary:** new-metric flow only — no editing existing tags, no tag rename/merge tooling, no permissions.
- **Constraints:** Cube-native `meta: { tags: [...] }` storage; no new Trino-direct path from frontend; reuse existing `schema-write-middleware`; React/TS/Vite/ui-kit stack.
- **Touchpoints:** `src/QueryBuilderV2/NewMetric/**`, `vite-plugins/schema-write-handler.ts`, `src/QueryBuilderV2/sidebar/*` (existing measure list).

## Final Design

### Layout

Fullscreen modal — 3 columns:
- **Top bar:** stepper (3 circles + connectors, orange `#f05a22` active)
- **Main column:** step content (scrollable form)
- **Right rail (~360px):** persistent YAML preview + live preview card (active step 3)
- **Footer:** Cancel · Back · Next/Define

### Step Breakdown

| Step | Title | Contents | Gate |
|------|-------|----------|------|
| 1 | Define | Source · Operation · Of · Filter (existing 4 sections, repackaged) | Source + Op + Of; ratio needs Of-B |
| 2 | Identify | Name · Title · Description · **Tags** · Format | Name (snake_case) + Title valid |
| 3 | Preview | Time dim picker · scalar card · 7d sparkline · Define / Discard | Auto-run debounced 500ms on entry; scalar-only fallback if cube has no time dim |

### State Extensions (`types.ts`)

```ts
type NewMetricDraft = {
  // ... existing fields
  tags: string[];                       // NEW
  previewTimeDimension: string | null;  // NEW
  previewRange: '7d' | '30d';           // NEW — default '7d'
};
```

### Tag Mechanics

- **Storage:** `meta: { tags: [...] }` on the measure (Cube-native). Splice via existing `generate-measure-yaml.ts` (extended).
- **Suggestions:** aggregate from Cube `/meta` — every measure exposes `meta.tags`. No new endpoint.
- **Sidebar filter chips:** mount above measures only (tags measure-scoped per Cube). Multi-select union. URL-param persisted.

### Live Preview — commit-then-preview (Option A)

Chosen path. Trade-offs accepted:

1. On entering step 3, fire YAML write (same as current Define) → poll `/meta` → call `/load` with `measures=[new]`, `timeDimensions=[{ dimension, granularity: day, dateRange: 'last 7 days' }]`.
2. Render scalar from total + sparkline from time series.
3. Step-3 footer adds **Discard** (red, confirm dialog) → calls new `DELETE /api/playground/schema/write` route that restores `.bak`.
4. Define button = "I'm keeping this" — closes wizard, triggers `refreshMeta()` so sidebar shows new measure + tags.

**Why not Option B (scratch overlay):** requires Cube to watch a `_preview/` folder; more moving parts; restart-on-rename complexity.

**Why not Option C (synthetic SQL):** would need a Postgres-wire client in dev middleware; high cost; risks drift from real Cube planner.

**Risk:** user closes browser between preview and Define — file stays on disk. Mitigation: audit log already in place; `git checkout` recovers; Discard button is prominent.

### Preview Rendering

- Scalar: `<big number, Geist font>`, no transformation (raw measure value).
- Sparkline: Recharts `<LineChart>` 60px height, no axes, brand orange stroke. Lazy import.
- Time-dim picker: select from cube dimensions with `type: time`. If none, hide sparkline + show only scalar.

### Files

**Modify:**
- `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx` — replace single-pane with stepper shell
- `src/QueryBuilderV2/NewMetric/sections/*.tsx` — keep, move into step containers
- `src/QueryBuilderV2/NewMetric/types.ts` — add `tags`, `previewTimeDimension`, `previewRange`
- `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` — extend reducer + validation
- `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` — emit `meta: { tags: [...] }`
- `src/QueryBuilderV2/NewMetric/api.ts` — add `deleteSchemaWrite()` client
- `vite-plugins/schema-write-handler.ts` — add `DELETE` method (restore from `.bak`)

**New:**
- `src/QueryBuilderV2/NewMetric/components/Stepper.tsx`
- `src/QueryBuilderV2/NewMetric/components/TagCombo.tsx`
- `src/QueryBuilderV2/NewMetric/steps/{step-define,step-identify,step-preview}.tsx`
- `src/QueryBuilderV2/NewMetric/preview/live-preview-card.tsx`
- `src/QueryBuilderV2/NewMetric/hooks/use-live-preview.ts`
- `src/QueryBuilderV2/NewMetric/hooks/use-existing-tags.ts`
- `src/QueryBuilderV2/sidebar/TagFilterChips.tsx` — wire into existing measure list rendering

### Out of Scope

- Editing tags on existing measures
- Tag rename / merge / canonicalization
- Server-side tag dedup or validation
- Permissions / ownership
- Tagging dimensions (measures only)

## Success Metrics

- All 5 existing wizard tests still pass; new tests added for steps, tag combo, live-preview hook, tag-filter chips
- Define-end-to-end: pick source → fill form → preview shows real number from Trino → click Define → measure appears in sidebar with tag chips visible
- Discard: clicking removes the YAML and restores `.bak`; new measure does not appear in /meta after refresh

## Implementation Considerations / Risks

| Risk | Mitigation |
|------|------------|
| Commit-then-preview leaves orphan files if user abandons | Audit log + `git checkout`; prominent Discard button |
| Sparkline query expensive on large cubes | Default 7d range, day granularity; cap parallel preview runs (debounce + lock) |
| Tag suggestions stale until `/meta` refresh | Refresh on wizard open; rely on existing `refreshMeta` hook |
| Cube hot-reload still flakey on Windows | Already mitigated via `CHOKIDAR_USEPOLLING=true` in `metrics-catalogue/docker-compose.yml` |
| Step 1 form is dense — could feel cramped | Keep existing 4-section dividers inside the step; scrollable |

## Open Questions

None — all 3 deferred questions resolved:
- TagFilterChips above measures only ✓
- Scalar-only fallback allowed when cube has no time dim ✓
- Discard requires confirm dialog ✓

## Next Steps

Proceed to `/ck:plan` to break this into phases.
