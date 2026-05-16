---
phase: 5
title: "Live preview — scalar + sparkline + Discard"
status: pending
priority: P2
effort: "1.5d"
dependencies: [3]
---

# Phase 5: Live preview — scalar + sparkline + Discard

## Overview

Replace dry-run SQL with real query results. On entering step 3, write the YAML (existing `postSchemaWrite` flow) → poll `/meta` → call `/load` with `measures=[new]`, optional `timeDimensions=[{ ... }]`. Render a big scalar + 7d/30d sparkline. Add a Discard button that deletes the written YAML and restores `.bak`. Discard requires confirm.

## Requirements

- **Functional:**
  - Live preview auto-runs on step-3 entry; re-runs on earlier-step changes with 500ms debounce
  - Scalar card shows the single value (Geist font, brand-aware sign coloring)
  - Sparkline shows 7d or 30d series via Recharts; hidden when sourceCube has no time dimension
  - Time-dim picker lists dimensions with `type: time` on the source cube
  - Discard button on step 3 deletes the new measure (DELETE route restores `.bak`) + closes wizard
  - Discard requires confirmation modal ("Discard and revert? This removes the measure from the YAML.")
  - Define button (renamed from generic "Define") = "Keep" — closes wizard + triggers `refreshMeta`
- **Non-functional:**
  - Concurrent preview runs locked (no double-fire on rapid edits)
  - Sparkline component lazy-loaded (Recharts is heavy)
  - Scalar-only fallback when no time dim — render scalar card without sparkline section

## Architecture

```
StepPreview
├── TimeDimSelect (auto-pick first time-type dim by default; user can change)
├── RangeToggle (7d | 30d)
├── LivePreviewCard
│   ├── ScalarTile (big number)
│   └── Sparkline (Recharts LineChart, height 60px, no axes)
└── DiscardButton (red, secondary)

[Flow]
Step-3 enter → run write (existing postSchemaWrite) → wait /meta → /load → render
  if write fails: show error banner, Define disabled, only Cancel works
  if /load fails: show error banner; user can retry or Discard
  if no time dim: skip sparkline; scalar uses /load without timeDimensions
```

## Related Code Files

- **Modify:**
  - `src/QueryBuilderV2/NewMetric/steps/step-preview.tsx` — replace placeholder with live preview
  - `src/QueryBuilderV2/NewMetric/api.ts` — add `deleteSchemaWrite({ cubeName, measureName })` client
  - `vite-plugins/schema-write-handler.ts` — add `DELETE` method handler that restores from `.bak`
  - `vite-plugins/schema-file-ops.ts` — `writeBak` first-write-wins guard (skip if `.bak` exists)
  - `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx` — wire Discard handler + confirm dialog
- **Create:**
  - `src/QueryBuilderV2/NewMetric/preview/live-preview-card.tsx` — scalar + sparkline composition
  - `src/QueryBuilderV2/NewMetric/preview/scalar-tile.tsx` — big-number rendering
  - `src/QueryBuilderV2/NewMetric/preview/sparkline.tsx` — Recharts wrapper (lazy)
  - `src/QueryBuilderV2/NewMetric/components/time-dim-select.tsx`
  - `src/QueryBuilderV2/NewMetric/components/discard-confirm.tsx` — confirm modal
  - `src/QueryBuilderV2/NewMetric/hooks/use-live-preview.ts` — debounced write+poll+load orchestrator
- **Read for context:**
  - `vite-plugins/schema-file-ops.ts` — `.bak` rename semantics
  - `vite-plugins/meta-poll.ts` — `waitForMember` poll utility (reuse for write-then-load chain)

## Implementation Steps

<!-- Updated: Validation Session 1 — .bak first-write-wins guard + auto-Discard on measure-name change -->

1. **`.bak` strategy fix (foundation):** Update `vite-plugins/schema-file-ops.ts` `writeBak` to be first-write-wins per session — only write `.bak` if the target's `.bak` does NOT already exist (`fs.access` check). Reason: existing `writeBak` unconditionally overwrites; debounced preview re-runs would clobber the true pre-wizard original.
2. **DELETE route in middleware:**
   - In `schema-write-handler.ts`, accept `DELETE`. Body: `{ cubeName, measureName }`. Read `.bak`, atomic rename `.bak` → target, audit-log the `delete-after-preview` event.
   - Handle "no .bak found" → return 404 `no-backup-found`.
3. **API client:** `deleteSchemaWrite({ cubeName, measureName }): Promise<{ ok: boolean; reason?: string }>` in `api.ts`.
4. **`useLivePreview` hook:**
   - Inputs: `draft`, `cubeName`, `measureName`, `timeDim`, `range`
   - State: `'idle' | 'discarding-prior' | 'writing' | 'polling' | 'loading' | 'success' | 'error'` + result data
   - Tracks `lastWritten: { cubeName, measureName } | null` in a ref
   - Sequence: **(a)** if `lastWritten` exists AND `(cubeName, measureName)` differs → fire `deleteSchemaWrite(lastWritten)` first; **(b)** postSchemaWrite → waitForMember (15s) → cubeApi.load({ measures: [new], timeDimensions: [{ dimension, granularity: 'day', dateRange: 'last 7 days' }] }); **(c)** update `lastWritten` on success
   - Debounced 500ms on earlier-step changes; re-runs whole sequence
   - Concurrency lock (AbortController per run); prior pending run aborted on new trigger
   - On unmount: do NOT auto-discard — leaves file intact so user retains the option to recover. Explicit Discard or Define is the only cleanup path.
   - Returns: `{ status, scalar, series, error, run }`
5. **Scalar tile:** big number rendering, Geist font, sign-based color (negative red, positive green-ish neutral). No transformation — raw measure value.
6. **Sparkline:** lazy import Recharts. `<LineChart>` height 60, no axes, single orange stroke. Memoize on series identity.
7. **Time-dim picker:** filter `meta.cubes[<sourceCube>].dimensions` where `type === 'time'`. Auto-pick first; show "No time dimension on this cube — sparkline disabled" hint when empty.
8. **Discard flow:**
   - Discard button on step 3, red secondary style
   - On click: open confirm modal
   - Confirm → call `deleteSchemaWrite(lastWritten)` → close wizard + reset draft + `refreshMeta`
   - Error → show banner inside the modal
9. **Define semantics:** Define button now means "Keep this preview". On click: simply close wizard + reset + refreshMeta. The YAML is already written.
10. Tests:
   - `useLivePreview` mock cubeApi.load + waitForMember; success path, write-fail path, load-fail path, debounce
   - `deleteSchemaWrite` API contract (success / 404)
   - Snapshot for live-preview-card with/without sparkline

## Success Criteria

- [ ] On step-3 entry, scalar appears within ~3-5s for a small cube
- [ ] Changing source cube on step 1 → coming back to step 3 → re-runs preview (debounced)
- [ ] Discard prompts confirm → on confirm removes file + closes wizard; measure not in `/meta` after refresh
- [ ] Define closes wizard, measure persists in `/meta`
- [ ] Cube without time dimension: scalar renders, sparkline hidden, helper text shown
- [ ] All P3 tests still pass

## Risk Assessment

- **Risk:** `/load` slow on large cubes → mitigation: 7d default, day granularity; show loading state ≥ 500ms.
- **Risk:** user abandons mid-preview, file remains on disk → mitigation: audit log + Discard button + plan-level documented behavior; git checkout recovers.
- **Risk:** `.bak` doesn't exist (first write of a fresh cube file) → mitigation: the existing `schema-file-ops.writeBak` writes `.bak` BEFORE rename, so by step 3 the `.bak` exists; DELETE route handles 404 gracefully.
- **Risk (RESOLVED via auto-Discard):** Race: write of new measure A → user changes draft → write of measure B (different name) → file accumulates orphans. Mitigation now LOCKED: `useLivePreview` tracks `lastWritten` ref and auto-fires `deleteSchemaWrite(prior)` before writing the new name. Step 4 implementation step.
- **Risk (RESOLVED via first-write-wins guard):** `.bak` clobber. `schema-file-ops.writeBak` is unconditional today (verified at `schema-file-ops.ts:70`). Mitigation now LOCKED: Step 1 patches `writeBak` to skip write if `.bak` already exists. True pre-wizard original is preserved across all preview re-runs.

## Security Considerations

- DELETE route is dev-only (apply: 'serve' gate already in place via the middleware). Reuses existing `NODE_ENV !== 'development'` guard from the write handler.
