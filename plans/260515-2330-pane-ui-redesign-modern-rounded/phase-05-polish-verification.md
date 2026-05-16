---
phase: 5
title: "Polish + verification"
status: complete
priority: P2
effort: "2-3h"
dependencies: [4]
---

# Phase 5: Polish + verification

## Overview

Final pass: tighten any visual deltas vs reference, verify all resize interactions persist correctly, run lint/typecheck/build/tests, capture an after-screenshot for the PR, and update docs.

## Requirements

**Functional**
- All resize interactions work: drag sidebar, drag chart, collapse chart, collapse-then-expand restores size, reload restores all sizes
- `disableSidebarResizing` consumer path verified
- Existing route `/playground` and `/playground?query=...` deep-link still works
- No regressions on `/data-model`, `/settings`

**Non-functional**
- Build passes (`npm run build`)
- TypeScript clean (`npm run typecheck`)
- Vitest passes (`npm run test`)
- No new console errors/warnings in dev
- File-size check: every modified or created `.tsx` ≤ 200 lines (per CLAUDE.md)

## Architecture

No architecture change. Pure verification + polish.

## Related Code Files

- **Possibly modify:** any of the previously touched files if visual drift remains
- **Modify:** `docs/codebase-summary.md` — add the new `src/components/AppPanes/` module
- **Modify:** `docs/code-standards.md` — note the pane-pattern (rounded outer + PaneHeader/PaneBody)
- **Modify (optional):** `README.md` — note the resize lib swap if user-visible

## Implementation Steps

1. **Visual diff pass**:
   - Open `http://localhost:3000/playground` next to the reference screenshot.
   - Check radius (12-14px outer, 12px inner), gap (~10px), border (`--border-card`), shadow (subtle), section label color (`--text-muted`), font (Geist), brand orange on Run button.
   - Fix any 1-3px deltas in tokens.

2. **Interaction matrix**:
   | Action | Expected |
   |---|---|
   | Drag sidebar boundary | Width changes, no jitter |
   | Drag chart boundary | Width changes, both adjacent panes resize |
   | Collapse chart | Pane becomes 36px rail, center fills |
   | Expand chart | Restores previous width |
   | Reload page | All sizes restored from autoSaveId |
   | Switch route + back | Sizes preserved |
   | Disable sidebar resize prop (if any consumer toggles) | Sidebar fixed-width |
   | Open `/playground` for first time (clean localStorage) | Default sizes used |

3. **Accessibility quick-pass**:
   - Resize handles: confirm `role="separator"` (default from lib) and keyboard arrow-key resize works (`react-resizable-panels` ships with this).
   - Tab order: still goes sidebar → toolbar → pill bar → filters → tabs (no reorder).
   - Color contrast: `--text-muted` on `--bg-card` ≥ 4.5:1 (#737373 on #fff = 4.83:1 ✓).

4. **Code hygiene**:
   - `npm run typecheck`
   - `npm run test`
   - `npm run build`
   - Grep for unused: `ResizablePanel` imports from ui-kit (should be 0 in src after Phase 2)
   - Grep for unused localStorage keys: `gds-cube:chart-pane-width`, `QueryBuilder:Sidebar:size` — if dead, delete reads/writes (autoSaveId handles persistence now)

5. **Docs**:
   - Update `docs/codebase-summary.md` to mention `src/components/AppPanes/` and the resize-lib choice.
   - Update `docs/code-standards.md` with the "pane pattern" — what wraps in `AppPane` vs inner `<Card>`.

6. **Screenshot for PR**:
   - Render `/playground` at 1440×900 with a sample query (DAU, Revenue + last 14d) to mirror the reference.
   - Save to `plans/260515-2330-pane-ui-redesign-modern-rounded/visuals/after.png`.

7. **Commit + PR**:
   - Conventional commit: `feat(query-builder): redesign panes — rounded cards, gap-separated, react-resizable-panels`.
   - PR description references this plan path and includes before/after screenshots.

## Todo List

- [ ] Visual diff pass complete; any drift fixed
- [ ] Interaction matrix verified
- [ ] Accessibility quick-pass passes
- [ ] `npm run typecheck` clean
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds
- [ ] No unused `ResizablePanel` imports remain in `src/`
- [ ] Dead localStorage keys removed (or documented as legacy-tolerated)
- [ ] `docs/codebase-summary.md` updated
- [ ] `docs/code-standards.md` updated (pane pattern)
- [ ] `after.png` captured at 1440×900
- [ ] Commit + PR created

## Success Criteria

- [ ] No console errors in dev or production build
- [ ] All resize interactions match the expected behavior matrix
- [ ] Visual parity with reference ≥ 95% (subjective but verified by side-by-side)
- [ ] All tests pass
- [ ] All files touched are ≤ 200 lines (modularize if any grew past)
- [ ] Docs updated to reflect new module + pattern

## Risk Assessment

- **Performance regression**: `react-resizable-panels` is lightweight (<10KB gz), shouldn't measurably slow first paint. Verify with Vite build output.
- **Visual drift on smaller viewports**: reference is 1440 wide. Mobile/narrow tablet not part of this scope but check ≥ 1024px breakpoint doesn't break.
- **localStorage key collision**: `autoSaveId="QueryBuilder:Panes"` is a unique namespace. No clash with prior keys.

## Security Considerations

None. UI-only.

## Next Steps

→ Ship. If issues surface in PR review, those become a follow-up plan or scoped fixups.
