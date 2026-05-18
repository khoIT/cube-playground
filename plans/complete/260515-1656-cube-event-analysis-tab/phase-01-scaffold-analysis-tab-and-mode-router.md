---
phase: 1
title: "Scaffold Analysis tab and mode router"
status: pending
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Scaffold Analysis tab and mode router

## Context Links
- Tabs definition: `src/QueryBuilderV2/QueryBuilderInternals.tsx:32` (`type Tab`)
- Tab state: same file `:51` (`useState<Tab>('results')`)
- Tab onChange: same file `:66`
- Research: `plans/reports/research-260515-1611-cube-event-exploration-gaps-vs-product-analytics.md` §4 (recommends Tab approach Option A)

## Overview

Extend the Tab union with `'analysis'`, register the tab in the existing antd `Tabs` block, and render a thin `<AnalysisPanel/>` shell with a mode picker. No mode bodies yet — phases 2–4 fill them in.

## Key Insights

- Tab strip is antd 4 `Tabs` keyed by string. Reorder is safe; existing labels untouched (decided in revamp Phase 5).
- Mode state lives in `AnalysisPanel` local state — NOT in QueryBuilderContext. Modes are presentational, share the same underlying `context.query`.
- Mode picker is antd `Radio.Group` (already used elsewhere in QBv2; no new dep).

## Requirements

**Functional**
- New tab "Analysis" appears in the tab strip between "Results" and "SQL".
- Clicking tab renders `<AnalysisPanel/>` with mode picker `[Breakdown | Distribution | Funnel]`.
- Picker defaults to `breakdown`.
- Mode switch updates picker state; placeholder div renders mode name for now ("Breakdown mode — coming in phase 2").
- No regression on existing tabs.

**Non-functional**
- All new files < 200 LOC.
- No new npm deps.
- Build green (`npx vite build` exits 0).

## Architecture

```
QueryBuilderInternals.tsx (modify)
└── Tabs
    ├── Results
    ├── Analysis  ← NEW
    │   └── <AnalysisPanel/>
    │       ├── <ModePicker mode={mode} onChange={setMode}/>
    │       └── { mode === 'breakdown' && <BreakdownPlaceholder/> }
    │       └── { mode === 'distribution' && <DistributionPlaceholder/> }
    │       └── { mode === 'funnel' && <FunnelPlaceholder/> }
    ├── SQL
    ├── JSON
    ├── REST
    └── GraphQL
```

## Related Code Files

**Modify**
- `src/QueryBuilderV2/QueryBuilderInternals.tsx` — add `'analysis'` to `Tab` union; add `<Tabs.TabPane key="analysis" tab="Analysis">` rendering `<AnalysisPanel/>`.

**Create**
- `src/QueryBuilderV2/analysis/AnalysisPanel.tsx` (~80 LOC) — shell + local `useState<'breakdown'|'distribution'|'funnel'>('breakdown')`.
- `src/QueryBuilderV2/analysis/mode-picker.tsx` (~60 LOC) — Radio.Group, three options, kebab-case file as per project rule.

## Implementation Steps

1. Read `QueryBuilderInternals.tsx` end-to-end (~150 LOC). Confirm Tab union + `Tabs.TabPane` syntax for the antd version used.
2. Add `'analysis'` to `Tab` union at line 32. Default state unchanged (`'results'`).
3. Insert a `<Tabs.TabPane key="analysis" tab="Analysis"><AnalysisPanel/></Tabs.TabPane>` after the Results tab, before the SQL tabs.
4. Create `src/QueryBuilderV2/analysis/AnalysisPanel.tsx`:
   - Local mode state.
   - Render `<ModePicker/>` + 3 inline placeholder divs.
5. Create `src/QueryBuilderV2/analysis/mode-picker.tsx`:
   - antd `Radio.Group` with button-style.
   - Props: `mode`, `onChange`.
   - Three options with labels "Breakdown", "Distribution", "Funnel".
6. `npx vite build` — confirm 0 exit.
7. Manual smoke: open `/build`, click Analysis tab, click each radio, see correct placeholder.

## Todo List

- [ ] Add `'analysis'` to Tab union
- [ ] Insert TabPane in JSX
- [ ] Create `AnalysisPanel.tsx` with mode state
- [ ] Create `mode-picker.tsx` Radio.Group
- [ ] Manual smoke: tab visible, picker switches placeholders
- [ ] `npx vite build` passes

## Success Criteria

- [ ] New tab visible in `/build` page tab strip.
- [ ] Mode picker switches between 3 placeholders.
- [ ] No console errors on tab switch.
- [ ] Build green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tabs primitive in antd 4 differs from assumed `TabPane` syntax | Low | Low | Verify in step 1; if API differs use `items={[...]}` form |
| Tab visibility hidden behind permissions guard we missed | Low | Low | Grep for tab filter logic; should be none |
| Local `mode` state lost on tab switch | Low | Low | Acceptable v1; persist later if user complaints |

## Security Considerations

None. UI shell only.

## Next Steps

Phase 2 fills Breakdown mode body. Phases 3 + 4 are independent and can be parallelized once Phase 1 lands.
