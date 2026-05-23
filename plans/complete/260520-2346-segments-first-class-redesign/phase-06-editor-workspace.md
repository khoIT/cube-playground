---
phase: 6
title: "Editor workspace"
status: pending
priority: P2
effort: "2d"
dependencies: [2]
brainstormId: P4
---

# Phase 6 (P4): Editor workspace

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §7
- Mockup: `../visuals/segments-first-class-mockup.html` — Editor screen
- Existing Editor: `src/pages/Segments/editor/{editor-view,identity-card,refresh-behaviour-card,predicate-builder/*,right-rail/*,hooks/*}`

## Overview

Recompose the editor as a 3-column workspace: **left rail** (256px step list) · **center** (active step body) · **right rail** (288px live preview with size estimate + drift). Replaces the current flat card-stack layout. Identity-map page becomes a sub-action ("Edit identity map →") reachable from the Identity step.

## Key Insights

- Today's editor is functional but flat — users don't perceive a "save my work" progression. Steps rail makes the flow explicit.
- Live preview reuses an existing pattern (preset preview-size logic) but lifts it into a persistent right-rail panel. Drift indicator already computed via `segment-status.ts`.
- Identity-map standalone route stays for direct deep-links; the editor surfaces it via inline link rather than as a primary CTA.
- 4 steps: Identity · Predicate · Refresh · Activate. The Activate step is **disabled** in this phase (Phase 7 enables real activation flow); it appears in the rail as a foreshadowing affordance.

## Requirements

**Functional**
- Workspace grid: `256px 1fr 288px` at ≥1200px viewport; collapses to single-column below.
- Left rail:
  - Title: `New segment` (or `Edit · {segment.name}` when editing).
  - 4 steps with marker (number / check / active orange ring), title, sub-label.
  - Step click navigates between steps; saves draft state in URL `?step=identity|predicate|refresh|activate`.
  - Bottom: "Edit identity map →" linking to `/segments/identity-map`.
- Center column:
  - Active step body content.
  - Breadcrumb at top: `Library > New segment` (or `> {name}` when editing).
  - Title `<h2>{stepLabel}</h2>` + one-line description.
  - Per-step body content (see §Step contents below).
  - Footer: `Back` · `Continue →` (Cancel is in top-right of center column, ghost button).
- Right rail (persistent across all steps):
  - "Live preview" heading.
  - Est. size card: `~{count}` formatted, secondary label, sparkline, drift `+X%` vs saved baseline (for edit mode).
  - Query cost card: latency + row count + cached/dims badges.
  - Footnote: "Preview re-runs as you edit. Identity column changes invalidate the cache."
- Step contents:
  - **Identity**: Cube picker (game-scoped via Phase 2 context), Identity field picker (driven by cube schema), Name input, Tags multiselect, info-notice about post-refresh immutability.
  - **Predicate**: reuse existing `predicate-builder/` component.
  - **Refresh**: reuse existing `refresh-behaviour-card.tsx` content, dropped into the workspace center.
  - **Activate**: empty-state with "Coming soon" / Phase 7 will hook in Activate-to-CDP entry from here.
- New mode (`/segments/new`) starts at Identity step. Edit mode (`/segments/:id/edit`) starts at Predicate step.

**Non-functional**
- Workspace component per-file ≤ 200 LOC.
- Live-preview fetch debounced (300ms) on any form field change.
- Preserve all existing predicate-builder + refresh-card behavior.

## Architecture

```
src/pages/Segments/editor/
  ├─ editor-view.tsx                — orchestrator (3-col grid, step routing)
  ├─ workspace-rail.tsx             NEW — left rail with steps
  ├─ workspace-preview.tsx          NEW — right rail
  ├─ steps/
  │   ├─ identity-step.tsx          NEW — wraps existing identity-card.tsx
  │   ├─ predicate-step.tsx         NEW — wraps predicate-builder/
  │   ├─ refresh-step.tsx           NEW — wraps refresh-behaviour-card.tsx
  │   └─ activate-step.tsx          NEW — empty state (Phase 7 fills)
  ├─ use-step.ts                    NEW — URL ?step= persistence + navigation
  ├─ use-preview-size.ts            NEW — debounced Cube query for est. size
  ├─ identity-card.tsx              KEEP — wrapped by identity-step
  ├─ refresh-behaviour-card.tsx     KEEP — wrapped by refresh-step
  ├─ predicate-builder/             KEEP — wrapped by predicate-step
  ├─ right-rail/                    REVIEW — most content moves to workspace-preview; deprecate file by file
  └─ hooks/                         KEEP
```

## Related Code Files

**Create**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/workspace-rail.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/workspace-preview.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/use-step.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/use-preview-size.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/steps/identity-step.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/steps/predicate-step.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/steps/refresh-step.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/steps/activate-step.tsx`

**Modify**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/editor-view.tsx` (recompose to 3-col grid + step orchestrator)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/segments.module.css` (workspace grid + step styles + preview card styles)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/identity-card.tsx` (extract pure content; identity-step.tsx wraps it)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/editor/refresh-behaviour-card.tsx` (same — extract pure content)
- `/Users/lap16299/Documents/code/cube-playground/src/i18n/*` (workspace + step labels, sentence-case)

**Delete** — Audit `right-rail/` contents after wrapping content into `workspace-preview.tsx`; delete only files with no remaining consumer.

## Implementation Steps

1. **Workspace shell** — `editor-view.tsx` becomes a 3-col CSS grid orchestrator. State for active step via `useStep()`. Pass `segment`/`draft` down to active step component.
2. **`use-step.ts`** — URL `?step=` persistence. Initial step: `identity` for new mode, `predicate` for edit mode (or last visited via state).
3. **Workspace rail** — `workspace-rail.tsx`: 4 step items with marker rendering rules (numbered → check when complete → orange ring when active). Bottom link to identity-map.
4. **Workspace preview** — `workspace-preview.tsx`: renders est. size card + query cost card + footnote. Reads from `usePreviewSize(draft)` hook (debounced).
5. **`use-preview-size.ts`** — Debounced (300ms) Cube `query` call from current draft (cube + identity + predicate). Returns `{ estSize, sparkline, drift, latencyMs, rowCount, cached }`. Drift compares vs `segment.uid_count` when editing.
6. **Identity step** — Wraps existing `identity-card.tsx` content into the workspace center body shape (title + form fields + info notice + footer Back/Continue).
7. **Predicate step** — Wraps existing `predicate-builder/` into same body shape.
8. **Refresh step** — Wraps existing `refresh-behaviour-card.tsx` into same body shape.
9. **Activate step** — Empty state card: "Activation lives in the segment Activation tab after save. (Phase 7 will surface a direct entry here.)"
10. **CSS** — Add `.workspace`, `.workspace-rail`, `.step`, `.workspace-center`, `.workspace-preview` styles per mockup.
11. **i18n** — Add step labels, breadcrumb text, info notice copy. Sentence-case sweep.
12. **Deprecate** — After wrapping existing content into steps, audit `right-rail/*` files. Delete those with no remaining import.

## Todo List

- [ ] Workspace 3-col grid CSS
- [ ] `editor-view.tsx` orchestrator
- [ ] `use-step.ts` URL persistence
- [ ] `workspace-rail.tsx` step list
- [ ] `workspace-preview.tsx` right rail
- [ ] `use-preview-size.ts` debounced Cube query
- [ ] `identity-step.tsx`
- [ ] `predicate-step.tsx`
- [ ] `refresh-step.tsx`
- [ ] `activate-step.tsx` empty state
- [ ] Audit + delete deprecated `right-rail/*`
- [ ] i18n step labels
- [ ] Manual QA: new mode starts on identity; edit mode starts on predicate; preview updates as fields change

## Success Criteria

- [ ] 3-col workspace renders at ≥1200px; collapses gracefully below.
- [ ] Step navigation persists via `?step=` URL param.
- [ ] Live preview updates within 500ms of form change.
- [ ] All existing predicate-builder + refresh-card behavior preserved.
- [ ] Identity-map deep link works from rail link.
- [ ] No regression in segment create / edit submission.
- [ ] No file in `editor/` exceeds 200 LOC.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Predicate-builder is complex; wrapping into a step container breaks internal state | M | Wrap only at the outer shell; do not refactor predicate-builder internals; verify state survives step switch via mount preservation |
| Live preview Cube query runs on every keystroke | M | Debounce 300ms; cancel in-flight on new edits; show spinner only for >150ms latency |
| Workspace below 1200px breaks layout | L | Single-column fallback: stack rail collapsed, center, preview becomes drawer |
| Existing `right-rail/` consumers outside editor break on delete | L | Grep before deleting; safe-delete |
| New mode default step coupling tests may break | L | Tests should drive via URL; document new default |

## Security Considerations

- Live preview Cube query inherits existing auth (security context bearer token).
- Identity-map link uses internal route; no external redirect.
- No new endpoints in this phase.

## Next Steps

Unblocks Phase 7 (Activate step body links into push-modal Activate-to-CDP tab). Phase 9 dark-mode pass audits workspace.
