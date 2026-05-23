---
phase: 6
title: "Wizards rebrand and composition"
status: done
priority: P2
effort: "4d"
dependencies: [2, 5]
---

# Phase 6: Wizards rebrand and composition

## Overview

Rebrand the current `NewMetricPage` wizard as "New building block" (label + copy only; behaviour unchanged). Build a new "Metric Composition" wizard for the Metrics tab. Extract `WizardShell` shared by both. Wire entry points from both tab CTAs.

## Requirements

**Functional:**
- Current wizard at `/metrics/new?v=2` renamed in UI: header, button label, success copy, step subtitles
- "+ New building block" button on Data Model tab → existing wizard
- New "Metric Composition" wizard at `/catalog/metric/new`
- Composition wizard 6 steps: Type · Numerator · Denominator · Slices · Parameter · Metadata
- Composition wizard writes valid `business-metrics/<id>.yml`
- Newly-created metric appears on Metrics tab without page refresh (registry refetch)
- Cross-link: composition wizard "create missing measure" → opens Building Block wizard w/ return URL
- Shared `WizardShell` extracted; both wizards depend on it

**Non-functional:**
- Composition wizard step nav as fast as building-block wizard (no perceptible diff)
- YAML write atomic (no partial files on disk)

## Architecture

```
src/shared/wizard-shell/             # NEW — extracted from current NewMetric/full-page/shell
├── wizard-shell.tsx                 # was Shell
├── wizard-left-rail.tsx             # was LeftRail
├── wizard-right-rail.tsx            # was RightRail
├── step-chrome.tsx                  # was step-chrome
├── validation-card.tsx              # was validation-card
└── types.ts

src/QueryBuilderV2/NewMetric/full-page/
├── NewMetricPage.tsx                # MODIFY — imports WizardShell from shared; UI text rebranded
├── shell/                           # REMOVE (rehomed to src/shared/wizard-shell/)
└── ...

src/pages/Catalog/metric-composition-wizard/
├── metric-composition-page.tsx      # NEW — route /catalog/metric/new
├── steps/
│   ├── step-1-type.tsx              # passthrough|ratio|parameterised
│   ├── step-2-numerator.tsx         # pick from Data Model concepts
│   ├── step-3-denominator.tsx       # skipped for passthrough
│   ├── step-4-slices.tsx            # suggest dims+segments
│   ├── step-5-parameter.tsx         # optional family
│   └── step-6-metadata.tsx          # id/label/synonyms/domain/tier/owner/description
├── use-composition-draft.ts         # NEW — mirrors useNewMetricDraft
├── write-business-metric-yaml.ts    # NEW — serialise + atomic write
└── __tests__/...
```

**Composition draft shape:**

```ts
type CompositionDraft = {
  id?: string;
  label?: string;
  description?: string;
  synonyms: string[];
  tier?: 1 | 2 | 3 | 4 | 5 | 6;
  domain?: Domain;
  owner?: string;
  formula?: { type: 'passthrough'; ref: string }
         | { type: 'ratio'; numerator: string; denominator: string }
         | { type: 'parameterised'; ...};
  parameter?: { name: string; options: string[] };
  related_concepts: string[];
};
```

**Cross-link:** if Step 2/3 user can't find a measure → button "Create missing measure" opens Building Block wizard with `?returnTo=/catalog/metric/new&prefill=<draft-id>`. On return, draft is rehydrated.

## Related Code Files

**Create:** ~12 files

**Modify:**
- `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — UI text + import from shared shell
- `src/QueryBuilderV2/NewMetric/NewMetricButton.tsx` — rename CTA label to "New building block"
- `src/pages/Catalog/data-model-tab/data-model-tab.tsx` — wire "+ New building block" header CTA
- `src/pages/Catalog/metrics-tab/metrics-tab.tsx` — wire "+ New metric" header CTA to composition wizard
- `src/pages/Catalog/catalog-page.tsx` — register `/catalog/metric/new` route

**Delete:** `src/QueryBuilderV2/NewMetric/full-page/shell/` (moved to shared)

## Implementation Steps

1. **Extract `WizardShell`.** Move `Shell`, `LeftRail`, `RightRail`, `StepChrome`, `ValidationCard` to `src/shared/wizard-shell/`. Update `NewMetricPage` imports. Verify no behaviour change.
2. **Rebrand current wizard text.** Search-and-replace:
   - `"New metric"` → `"New building block"` (button, header, page title)
   - `"Submit metric request"` → `"Submit building block"` (for measure)
   - Update success page copy
   - Update locale JSON if i18n keys are used
3. **Build `useCompositionDraft`** mirroring `useNewMetricDraft` (sessionStorage persist, `setField`, `setInput`, reset).
4. **Build 6 steps:**
   - Step 1: 3 radio cards (passthrough/ratio/parameterised)
   - Step 2: searchable picker over Data Model measure concepts; "Create missing" cross-link
   - Step 3: same picker for denominator; skip if passthrough
   - Step 4: suggest dims/segments from numerator's cube join graph
   - Step 5: optional `parameter.name` + `parameter.options[]` (chip input)
   - Step 6: metadata form (id auto-derive from label; synonyms TagCombo; tier select; domain select; owner input; description textarea; trust defaults `draft`)
5. **Build `write-business-metric-yaml`** — serialise draft → YAML → POST to backend endpoint (Option A) or local-file-write (dev only).
6. **Wire success flow** — on submit: refetch registry hook (invalidate cache); push to `/catalog/metric/<id>`.
7. **Wire cross-link** — Building Block wizard reads `?returnTo=` and `?prefill=`; on submit, redirect back with success toast.
8. **Test:**
   - Building Block wizard rebrand: snapshot tests for header text only; behaviour tests unchanged
   - Composition: complete a passthrough metric, assert YAML file written + appears on Metrics tab

## Success Criteria

- [ ] Building Block wizard UI labels changed; behaviour unchanged (existing tests pass)
- [ ] "+ New building block" on Data Model tab → current wizard
- [ ] "+ New metric" on Metrics tab → composition wizard
- [ ] Composition wizard 6 steps render
- [ ] Submitting passthrough metric writes valid YAML to `business-metrics/`
- [ ] Submitted metric appears on Metrics tab without manual refresh
- [ ] Cross-link Building Block ↔ Composition wizard preserves draft state
- [ ] `WizardShell` extracted; both wizards import from `src/shared/wizard-shell/`

## Risk Assessment

- **R4:** two wizards diverging UX. **Mitigation:** shared `WizardShell` mandatory from day one; no duplication.
- **YAML write needs backend endpoint** (POST). If P2 only built GET, P6 must extend the endpoint. **Mitigation:** flag in P2 implementation to also stub POST handler.
- **Atomic write** — partial YAML on crash could break registry load. **Mitigation:** write to temp file + rename (`fs.rename` is atomic on POSIX).
- **Rebranding text across i18n keys** — risk: stale key names left. **Mitigation:** grep for old strings in locale JSON.
- **Composition wizard step 2/3 picker over Data Model concepts** — needs `useConcepts()` from P5. Dependency chain enforced.
