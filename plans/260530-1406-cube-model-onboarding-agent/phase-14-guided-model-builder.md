# Phase 14 — Guided model builder (replace raw-YAML pane)

**Context:** [plan.md](./plan.md) · v2 Decision 3 (guided full builder). Replaces the raw-YAML
triage pane (`view-queue.tsx` `YamlPane`) with a step-by-step builder. Depends on Phase 11
(profiles) + reuses `metric-composition-wizard` stepper + v1 triage engine.

## Overview
- **Priority:** P1.
- **Status:** Planned.
- Walk the DA through model construction: **Cube → Dimensions → Measures → Joins → Preview**, with
  inference defaults pre-filled + confidence scores. YAML is the **compiled output at the final
  step** (preview + diff), not the editing surface.

## Key Insights
- The triage engine already holds the decision state (accept/reject per field) + compiles to YAML
  (`triage-shared.tsx` `YamlPane`, `state.yaml`). The builder is a **new front-end over the same
  state** — not a new engine. YAML stays as the final artifact via the existing scaffolder/writer.
- `metric-composition-wizard/composition-wizard-page.tsx` is an existing multi-step builder in this
  repo — reuse its stepper shell/navigation/validation-per-step pattern (don't re-invent).
- v1 ships three triage views (Queue+YAML / Graph / Chat). The builder becomes a **4th view**
  ("Builder", default for cold-start) so the YAML/Graph/Chat views remain for power users. Honors
  the per-user view preference already persisted via `/api/user-prefs`.

## Requirements
**Functional**
- Stepper steps, each pre-filled from inference + editable:
  1. **Cube** — name, `sql_table`, primary key (from uniqueness profiling), description.
  2. **Dimensions** — per-column include/exclude, type, title; confidence pill + sample values.
  3. **Measures** — proposed aggregations (count/sum/avg) with column + type; add custom.
  4. **Joins** — same-source relationships (FK candidates from profiling); cross-source links are
     declared but flagged (Phase 15 owns the cross-source semantics).
  5. **Preview** — compiled YAML + diff vs existing (if editing) + validate (`/load`) + stage.
- Builder reads/writes the same triage decision state; "accept all/none" still works.
- Step validation: can't proceed without a primary key / at least one measure (configurable).

**Non-functional**
- YAML never hand-edited in the builder path; it's generated. (Raw YAML view remains available.)

## Architecture
`builder-view.tsx` (stepper) ↔ triage engine state (`triage-shared.tsx`) → `cube-model-scaffolder`
→ compiled YAML → `/load` validate → `onboarding-draft-store` (stage) → approval (v1 gate).

## Related Code Files
- **Create:** `src/pages/Data/triage/view-builder.tsx` (+ small step components under a
  `builder/` subdir if >200 LOC).
- **Modify:** `src/pages/Data/triage/view-switch.tsx` (add Builder view + default for cold-start),
  `triage-canvas.tsx` (route to builder), reuse `triage-shared.tsx` state/compile.
- **Read for context:** `metric-composition-wizard/composition-wizard-page.tsx`, `view-queue.tsx`,
  `cube-model-scaffolder.ts`.

## Implementation Steps
1. Scaffold `view-builder.tsx` stepper shell from the composition-wizard pattern; bind to triage state.
2. Build the 5 steps as thin renderers over existing decision state (reuse ConfidencePill, field rows).
3. Final step: compiled-YAML preview + diff + validate + stage (reuse `TriageActionBar`).
4. Register as a view in `view-switch.tsx`; default Builder for cold-start, keep YAML/Graph/Chat.
5. Step-level validation gates (PK present, ≥1 measure).

## Todo
- [ ] view-builder stepper shell (reuse composition-wizard)
- [ ] Cube / Dimensions / Measures / Joins / Preview steps over triage state
- [ ] Compiled-YAML preview + diff + validate + stage at final step
- [ ] Register Builder view + cold-start default; keep existing views
- [ ] Per-step validation gates

## Success Criteria
- A DA models a freshly-introspected table end-to-end via steps without touching raw YAML; final
  step shows correct compiled YAML; stage → approval works exactly as v1.
- Switching to the YAML view shows the identical compiled result (single source of truth).

## Risks & Mitigation
- **State divergence (builder vs YAML view):** both read the ONE triage state; compile is the only
  YAML producer. Assert builder edits reflect in YAML view (test).
- **Scope creep per step:** keep steps thin renderers; no new engine logic.

## Security
- No new mutation surface beyond v1 stage/approve (RBAC + grant unchanged).

## Next
Phase 15 (Joins step gains cross-source semantics + flagging).
