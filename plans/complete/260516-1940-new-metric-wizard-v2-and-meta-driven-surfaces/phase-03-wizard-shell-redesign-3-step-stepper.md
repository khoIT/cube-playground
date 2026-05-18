---
phase: 3
title: "Wizard shell redesign — 3-step stepper"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1, 2]
---

# Phase 3: Wizard shell redesign — 3-step stepper

## Overview

Replace the single-pane Dialog layout in `NewMetricDialog.tsx` with a 3-step focused stepper modal matching the mockup. Repackage existing section components (Source / Operation / Of / Filter / Identity) into step containers. Build Stepper component (3 circles + connectors, brand orange `#f05a22` active). Add Back/Next/Define footer with per-step validation gates.

## Requirements

- **Functional:**
  - Modal is fullscreen, dark canvas, orange active accents
  - 3 steps: Define / Identify / Preview (preview content lands in P5)
  - Per-step validation: Next is disabled until current step is valid
  - Back navigation preserves draft state
  - Right rail keeps existing YAML preview always visible; live preview slot reserved for P5
  - Cancel resets draft (existing behavior)
- **Non-functional:**
  - Component split per CLAUDE.md modularization (≤200 lines per file)
  - All existing wizard tests pass
  - No CSS in `tasty('tag', ...)` form (existing bug); use styled-components

## Architecture

```
NewMetricDialog
├── Stepper (top)
├── StepFrame (main column, switches by currentStep)
│   ├── StepDefine     — Source + Operation + Of + Filter (existing sections, no logic change)
│   ├── StepIdentify   — Name + Title + Description + (TagCombo stub in P4) + Format
│   └── StepPreview    — placeholder card (filled in P5)
├── PreviewRail (right, 360px)
│   ├── YamlPreview (existing)
│   └── LivePreviewSlot (filled in P5)
└── Footer
    ├── Cancel
    ├── Back (disabled on step 1)
    ├── Next (steps 1-2) / Define (step 3)
```

Step state: `useState<1 | 2 | 3>(1)`. Validity per step computed from `validation.errors` keys:
- Step 1: sourceCube, operation, ofMember, ofMemberB
- Step 2: name, title (description + tags + format are optional)
- Step 3: previewTimeDimension (optional — preview falls back to scalar-only)

## Related Code Files

- **Modify:**
  - `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx` — replace body layout with stepper shell
- **Create:**
  - `src/QueryBuilderV2/NewMetric/components/stepper.tsx` — visual stepper (3 circles + connectors)
  - `src/QueryBuilderV2/NewMetric/components/step-frame.tsx` — current-step switcher
  - `src/QueryBuilderV2/NewMetric/steps/step-define.tsx` — wraps Source/Operation/Of/Filter
  - `src/QueryBuilderV2/NewMetric/steps/step-identify.tsx` — wraps Identity section
  - `src/QueryBuilderV2/NewMetric/steps/step-preview.tsx` — placeholder (P5 fills it)
  - `src/QueryBuilderV2/NewMetric/components/wizard-footer.tsx` — Cancel/Back/Next/Define buttons
  - `src/QueryBuilderV2/NewMetric/hooks/use-wizard-navigation.ts` — step state + per-step validity
- **Read for context:**
  - `src/QueryBuilderV2/NewMetric/sections/*.tsx` — keep as-is, just wrap in step containers

## Implementation Steps

1. Create `stepper.tsx`. Props: `steps: { id: 1|2|3; label: string }[]`, `current: 1|2|3`. Render circles with connector lines; current step orange filled, done step orange filled + checkmark, future step grey.
2. Create `use-wizard-navigation.ts`. Returns `{ currentStep, canGoNext, canGoBack, goNext, goBack, gotoStep }`. Computes step validity from full `validation.errors`.
3. Create step containers (`step-define`, `step-identify`, `step-preview`). They just compose existing section components — no business logic change.
4. Create `wizard-footer.tsx`. Renders Cancel / Back / Next/Define based on current step + validity.
5. Rewrite `NewMetricDialog.tsx` body:
   - Top: `<Stepper ...>`
   - Main: `<StepFrame current={currentStep}>`
   - Right rail: `<YamlPreview ...>` + `<LivePreviewSlot>` (renders only on step 3, content placeholder for P5)
   - Footer: `<WizardFooter ...>`
6. Visual styling: brand orange `#f05a22`, dark `#0a0a0a`. Use `var(--brand)` tokens already in `src/theme/tokens.css` if available; otherwise extend.
7. Tests:
   - Stepper renders correct active state for each currentStep value
   - useWizardNavigation: cannot advance from step 1 if no source/operation/of; can advance from step 2 if name+title valid
   - existing draft tests still pass

## Success Criteria

- [ ] Wizard opens to step 1; Back disabled
- [ ] Next disabled until step 1 valid; clicking Next advances + persists draft
- [ ] Step 3 shows Define button (still placeholder content); P5 fills the body
- [ ] Right-rail YAML preview always visible; updates on every keystroke
- [ ] All existing wizard tests pass

## Risk Assessment

- **Risk:** stepper layout breaks at narrow viewport — mitigation: dialog is fullscreen; min-width 1024px assumed.
- **Risk:** validation function from P2 doesn't expose per-step errors cleanly — mitigation: `use-wizard-navigation` computes step validity by intersecting `Object.keys(validation.errors)` with a per-step field list.
- **Risk:** existing sections need props refactor to fit step containers — mitigation: keep sections fully prop-driven (`draft`, `setField`, `validation`); no internal state changes.

## Security Considerations

- No new auth surface. Same dev-mode write semantics.
