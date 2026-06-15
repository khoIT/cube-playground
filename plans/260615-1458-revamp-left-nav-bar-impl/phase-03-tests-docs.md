---
phase: 3
title: Tests + docs
status: completed
priority: P2
effort: 2-3h
dependencies:
  - 1
  - 2
---

# Phase 3: Tests + docs

## Overview

Lock the two new behaviors with focused tests (none exist for collapse-toggle /
section / item today) and record the design departure so the next UI author
doesn't "fix" the flush seam back to a card gap.

## Requirements

- Functional:
  - Test the edge toggle: click toggles `setCollapsed`; `aria-label` flips with
    `collapsed`; correct chevron direction per state.
  - Test the split header: label click navigates (NavLink href correct, no
    toggle); arrow click toggles `setSectionExpanded` without navigating;
    `aria-label="Toggle {label} list"` present.
  - Keep the existing `sidebar-chat-recents-shared-inline.test.tsx` green.
- Non-functional:
  - Tests colocated under `src/shell/sidebar/__tests__/`, kebab-case names.
  - Mock `sidebar-collapsed-store` / `sidebar-section-store` where needed; render
    inside a `MemoryRouter` (sidebar uses `react-router-dom`).

## Related Code Files

- Create: `src/shell/sidebar/__tests__/sidebar-edge-toggle.test.tsx`.
- Create: `src/shell/sidebar/__tests__/sidebar-section-split-header.test.tsx`.
- Modify: `docs/design-guidelines.md` — note the flush sidebar↔main seam + the
  mouse-tracking edge circle as the canonical pattern (so it isn't reverted).
- Modify (if present): `docs/codebase-summary.md` — one line on the nav revamp.
- Read for context: existing `__tests__/sidebar-chat-recents-shared-inline.test.tsx`
  for the render/mock harness already in use.

## Implementation Steps

1. Write `sidebar-edge-toggle.test.tsx`:
   - renders with `aria-label="Collapse sidebar"` when expanded, `"Expand sidebar"`
     when `collapsed`;
   - `click` calls `setCollapsed(!collapsed)` (spy the store);
   - asserts `ChevronLeft` vs `ChevronRight` by role/test-id.
2. Write `sidebar-section-split-header.test.tsx`:
   - label/icon is an `<a href={to}>`; clicking it does NOT call
     `setSectionExpanded`;
   - arrow `<button aria-label="Toggle … list">` click calls `setSectionExpanded`
     and does NOT change `location`;
   - chevron rotation class/style reflects `expanded`.
3. Run `npm test -- src/shell/sidebar` (or the repo's vitest invocation); fix
   until green. Do NOT weaken assertions to pass.
4. Update `docs/design-guidelines.md` with the seam + edge-circle pattern and the
   "label navigates / arrow toggles" header rule.
5. Add a `docs/lessons-learned.md` entry only if a non-obvious bug surfaced during
   Phase 1-2 (e.g. click-bubbling, overflow clipping) — per repo convention.

## Success Criteria

- [ ] New edge-toggle + split-header tests pass; existing sidebar test still green.
- [ ] `npm run build` / typecheck clean.
- [ ] `docs/design-guidelines.md` documents the flush seam + arrow split so it
      survives future "design drift" reviews.
- [ ] No fake data / skipped assertions to force green.

## Risk Assessment

- **react-router version**: repo mixes v5 (`useHistory`, see `tab-shell.tsx`) and
  v6-style (`useLocation`/`NavLink` in sidebar). Confirm which `MemoryRouter` API
  the existing sidebar test uses and match it — don't introduce a second router idiom.
- **Tooltip timing**: the 400ms delay uses `setTimeout`; use fake timers if a test
  asserts tooltip text, or skip asserting the tooltip (behavioral, low value) to
  avoid flake.
