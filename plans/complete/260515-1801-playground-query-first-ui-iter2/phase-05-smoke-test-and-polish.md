---
phase: 5
title: "Smoke Test and Polish"
status: pending
priority: P2
effort: "1-2h"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Smoke Test and Polish

## Overview

Verify all four prior phases work together. Catch regressions in iteration-1 features (Analysis tab, query state, dev server proxy). Fix any visual misalignments. No new code unless polish-only.

**Priority:** P2 · **Status:** Pending · **Risk:** Low (verification phase).

## Key Insights

- Cross-phase interactions are the real bug surface — each phase passed individually does NOT guarantee they compose.
- Iteration-1 features must NOT regress; check Analysis tab, pre-agg alerts, RequestStatus, dev proxy.
- Polish is final-pass visual cleanup ONLY. No new features.

## Requirements

**Functional smoke (end-to-end query lifecycle):**
- Run a real query → pill bar updates → filter strip pills update → results table populates → chart renders in side pane → status indicator transitions.
- Apply a filter via the new strip → both filter strip count badge AND pill-bar filter row update.
- Toggle a cube off via sidebar Display panel → that cube's tree subtree hides.
- Open Settings dropdown → security context modal opens → set context → indicator dot appears on trigger.

**Persistence smoke:**
- Toggle filter strip collapsed → reload → still collapsed.
- Resize chart pane to ~50% → reload → restored.
- Collapse chart pane → reload → still collapsed.
- Uncheck "Players" cube → reload → still hidden.

**Cross-tab smoke:**
- Open two tabs → uncheck a cube in tab A → tab B sidebar updates within one frame.

**Iteration-1 regression smoke:**
- Analysis tab still renders pre-aggregation analysis (path: `src/QueryBuilderV2/analysis/`).
- Pre-aggregation alerts still show when applicable.
- RequestStatus banner still renders during loading + error states.
- Dev server proxy still routes API calls (no console fetch errors in dev mode).
- Run + Stop buttons still render simultaneously during loading (Run disabled+loading, Stop active).

**Polish:**
- Border-radius alignment between pill bar / filter strip / results card.
- Spacing tokens consistent (use UI-kit spacing variables, not hardcoded px).
- Focus rings visible on all new interactive elements (Settings dropdown, Display checkboxes, filter strip toggle, splitter handle, collapse button).
- Hover states present on splitter (cursor: col-resize) + collapse button.

## Architecture

No new architecture. This phase = test pass + bug fix. Any defects found → fix in-place in the phase's owning file. If defect is structural → file follow-up task, do NOT ship broken.

## Related Code Files

**Read for context (regression surface):**
- `src/QueryBuilderV2/analysis/` (whole dir)
- `src/QueryBuilderV2/QueryBuilderToolBar.tsx` (Run + Stop logic)
- `src/QueryBuilderV2/QueryBuilderResults.tsx` (Analysis tab, pre-agg alerts)
- `src/QueryBuilderV2/QueryStatePillBar.tsx` (title + LIVE badge only post-revamp)

**Modify (polish-only):**
- Whichever file owns the misaligned element. Document each fix in PR.

**No new files.**

## Implementation Steps

1. **Functional smoke (run dev server, manual test):**
   - End-to-end query → observe each surface updates.
   - Add filter via new strip → verify pill-bar row reflects same filter.
   - Toggle cube off → verify tree hides.
   - Settings dropdown → Security Context flow.
2. **Persistence smoke:** four reload tests above.
3. **Cross-tab smoke:** two-tab test (Display config sync).
4. **Regression smoke:** Analysis tab, pre-agg alerts, RequestStatus, dev proxy, Run+Stop simultaneous render.
5. **Polish pass (visual):**
   - Inspect border-radius continuity (pill bar → filter strip → results).
   - Inspect spacing tokens (use UI-kit vars; flag hardcoded px).
   - Tab through all new interactive elements → confirm focus rings.
   - Hover splitter handle → confirm `col-resize` cursor.
6. **Fix loop:** for each defect → fix in owning file → re-run affected smoke step → repeat until clean.
7. **Final compile** (`pnpm tsc --noEmit` or project script) → must be clean.
8. Document any deferred polish items as follow-ups (do NOT ship broken; do file remaining nits).

## Todo List

- [ ] Functional smoke (end-to-end query)
- [ ] Filter strip ↔ pill-bar sync check
- [ ] Sidebar Display toggle check
- [ ] Settings dropdown flow check
- [ ] Persistence smoke (4 reload tests)
- [ ] Cross-tab Display sync test
- [ ] Iteration-1 regression smoke (Analysis, pre-agg, RequestStatus, dev proxy, Run+Stop)
- [ ] Border-radius / spacing / focus-ring polish
- [ ] Final type-check
- [ ] File follow-up tickets for any deferred nits

## Success Criteria

- [ ] All functional smoke steps pass.
- [ ] All persistence smoke steps pass.
- [ ] Cross-tab Display sync works within one frame.
- [ ] Zero iteration-1 regressions.
- [ ] Visual polish items resolved or filed as follow-ups (none silently dropped).
- [ ] TypeScript compiles clean.
- [ ] No console errors on dev server during smoke.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Late-discovered regression in iteration-1 (Analysis, pre-agg) | Medium | High | Run regression smoke FIRST after Phase 4; fix before declaring polish-only. |
| Polish scope creep — discovering new UX issues | Medium | Low | Strict rule: anything not visual misalignment → follow-up ticket, NOT this phase. |
| Cross-tab sync fails on Safari (storage event quirks) | Low | Low | Test on Chrome + Safari; if Safari fails, document + file follow-up. |
| Chart pane fallback (Phase 4 risk) shipped instead of side-by-side | Possible | Medium | Verify which Phase-4 outcome shipped; smoke either layout works. |

**Rollback:** This phase only fixes bugs; no rollback needed. If a phase's bug is structural and unfixable in 1-2h → revert that phase, ship others.

## Next Steps

After ship: file iteration-3 backlog items (unified filter surface, AI-assist, schema editor, mobile responsive).
