---
phase: 6
title: "Frontend — Data hub + triage (3 views)"
status: complete
priority: P1
effort: "14h"
dependencies: [5]
---

# Phase 6: Frontend — Data hub + triage canvas (3 views)

## Overview
The DA-facing surface, built around a **Data hub of connectors** (not a standalone wizard).
Flow: Connectors list → Add connector → credentials → connector detail (tabbed) → dataset
tables + **mode pick** → **triage canvas**. The triage canvas is **one shared engine with
three interchangeable view renderers** (Queue+YAML / Entity graph / Conversational), selected
by a remembered per-user preference. Clickable reference prototype:
`plans/260530-1406-cube-model-onboarding-agent/visuals/onboarding-agent-flow.html`.

## Requirements
- Functional:
  - **Data hub**: connectors list (status dots, "+ Add"), add-connector catalog (Warehouse/MMP/Ad Networks), credentials form, connector detail with tabs **Datasets · Agents · Coverage · Drift · History**, dataset→tables view.
  - **Two onboarding modes** at the table-pick step: *Reference existing model (warm start — imitate sibling cubes)* vs *Model from scratch (cold start)*. Mode feeds the inference prior (Phase 02); UI converges after.
  - **Triage canvas, 3 views** over one decision state: (A) decision queue + live YAML, (B) entity graph, (C) conversational. Shared: "ask the agent" override box, validate, stage-for-approval.
  - **Effort scales with ambiguity**: high-confidence inferences auto-accepted (collapsed/auditable); only low-confidence calls surface in the queue.
- Non-functional: design-system tokens + page-header recipe; reuse `coverage-ui` primitives; per-user view preference persisted; accessible; large schemas virtualized.

## Architecture
- New route group `src/pages/Data/` + a single **Data** nav entry (mirror Dashboards/Settings registration).
- **Hub screens** (each <200 LOC):
  - `connectors-list.tsx` — connector cards + status; "+ Add connector".
  - `add-connector.tsx` — source catalog grid + filter chips; opens credentials drawer.
  - `connector-credentials.tsx` — connection form (read-only-introspection copy).
  - `connector-detail.tsx` — header + tab bar. **Datasets** tab is new; **Coverage**/**Drift** tabs *embed the existing* metric-coverage + drift-center surfaces scoped to this connector (see decision below); **History** = audit; **Agents** = onboarding/chat agents scoped here.
  - `dataset-tables.tsx` — profiled-tables table + the two **mode-pick** cards + select→Generate.
- **Triage — one engine, three views:**
  - `use-onboarding-draft.ts` — the shared hook: holds the draft model, the decision queue (open/resolved + confidence), YAML projection, validate state. **All three views render from this; resolving a decision in any view mutates the same state.** (Mirror `use-metric-coverage.ts`.)
  - `triage/view-queue.tsx` (A) · `triage/view-graph.tsx` (B) · `triage/view-chat.tsx` (C) — pure presentation over the hook.
  - `triage/view-switch.tsx` — toggles view; writes choice to user prefs.
  - `triage/ask-agent-box.tsx` — shared NL-override input (present in all views).
- **Per-user view preference**: persist `onboarding.triageView` via existing `/api/user-prefs` (already a write-role-gated prefix). Initial default by role (analyst→A, visual→B, non-technical→C); then "remember last used".
- Page-header per `Dashboards/index.tsx:16-21,137-139`. Status colors via semantic tokens.

## Related Code Files
- Create: `src/pages/Data/{connectors-list,add-connector,connector-credentials,connector-detail,dataset-tables}.tsx`, `src/pages/Data/triage/{view-queue,view-graph,view-chat,view-switch,ask-agent-box}.tsx`, `src/pages/Data/use-onboarding-draft.ts`.
- Modify: router + nav registration; `/api/user-prefs` schema (add `onboarding.triageView`).
- Read for context: `src/pages/Settings/coverage-ui.tsx:10-145` (primitives), `src/pages/Settings/use-metric-coverage.ts` (hook pattern), `src/pages/Dashboards/index.tsx:16-162` (page-header/layout), the drift-center page from `plans/260530-1204-metric-drift-center/` (Coverage/Drift tab embedding), `docs/design-guidelines.md` (mandatory), the prototype HTML above (flow + 3-view layouts).

## Implementation Steps
1. Register **Data** route group + nav; build connectors-list.
2. Build add-connector catalog + credentials drawer.
3. Build connector-detail shell + tabs; wire Datasets tab; embed Coverage/Drift (per decision).
4. Build dataset-tables + the two mode-pick cards; Generate → draft endpoints.
5. Build `use-onboarding-draft.ts` (shared decision/YAML/validate state).
6. Build **view A** (queue+YAML) — ship this as the default first.
7. Build **view B** (entity graph) and **view C** (conversational) as additive renderers over the same hook.
8. Build view-switch + persist `onboarding.triageView`; smart default by role + remember-last.
9. Shared ask-agent box, validate panel, stage-for-approval.
10. Cross-check visual drift vs Dashboards/Cohort; `web-design-guidelines` pass.

## Success Criteria
- [x] DA walks connector → dataset → mode → triage → staged draft, end to end.
- [x] All three triage views render the same decisions; resolving in one updates the shared state/YAML.
- [x] View preference persists per user and restores on return; A works standalone if B/C unbuilt.
- [x] Low-confidence inferences require explicit accept; high-confidence auto-accepted + auditable.
- [x] Visual parity with Dashboards/Settings; viewer sees read-only (no accept/approve/stage).

## Risk Assessment
- **3 views = 3× scope creep** → mitigated by the shared-engine split: engine once, views are thin renderers; ship A first, B/C additive. Guard against logic leaking into view components.
- **Graph view (B) complexity** → biggest renderer; if it slips, A+C still deliver. Consider a lib only if hand-rolled SVG gets unwieldy.
- **Design drift** → copy closest well-formed page; run `web-design-guidelines`.
- **Large schemas** → virtualize tables + graph nodes; default-collapse auto-mapped.
- **Confidence UX confusion** → per-field rationale tooltip (Phase 02 `rationale`).

<!-- Updated: Validation Session 1 -->
## Decided (validation 2026-05-30)
- **Coverage/Drift tabs → deep-link in v1.** Tabs route to the shipped `/drift-center` (`src/pages/DriftCenter/`) + coverage pages, connector-scoped. Inline embedding is a v1.5 fast-follow. (Removes the embed wiring from v1.)
- **All three triage views ship in v1** (A default). Build order A → C → B within v1; "A first" above is sequencing, not deferral. B (graph) carries the most risk — if it slips, it slips alone without blocking launch of A+C.
- **Hierarchy: workspace → connector → dataset → tables.** The connectors list is scoped to the active workspace (a workspace holds many connectors). Connector ≠ Cube workspace endpoint.
