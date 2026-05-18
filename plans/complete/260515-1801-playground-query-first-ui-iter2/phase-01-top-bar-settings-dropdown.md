---
phase: 1
title: "Top Bar Settings Dropdown"
status: pending
priority: P2
effort: "2h"
dependencies: []
---

# Phase 1: Top Bar Settings Dropdown

## Overview

Consolidate "Add Security Context" + "Add Rollup to Data Model" into a single `Settings ▼` dropdown on the right side of the top nav (same row as Playground/Models pills). Frees primary nav space; matches Cube v0.36 / Looker / Metabase right-aligned menu pattern.

**Priority:** P2 · **Status:** Pending · **Risk:** Low.

## Requirements

**Functional:**
- Single dropdown trigger labeled `Settings` with chevron, right-aligned in top nav.
- Menu item 1: `Security Context` → opens existing security context modal via `useSecurityContext()`.
- Menu item 2: `Add to Data Model` → triggers existing rollup-add flow (preserve current entry-point behavior).
- If a security context is already active, show indicator (badge or dot) on the trigger.

**Non-functional:**
- No regression to existing rollup/security flows.
- Keyboard accessible (Tab, Enter, Esc).
- Reuses existing `@cube-dev/ui-kit` `Menu`/`Dropdown` primitives — no new deps.

## Architecture

**Data flow:**
- `Header.tsx` consumes `useSecurityContext()` (already imported). No new state.
- Dropdown is purely presentational; click handlers delegate to existing modal openers.

**Component tree:**
```
Header
├── BrandBlock (logo, VNG badge)
├── NavPill (Playground / Models)
├── Spacer
├── SettingsDropdown (NEW inline JSX)   ← this phase
│   ├── MenuItem: Security Context
│   └── MenuItem: Add to Data Model
└── UserAvatar
```

**Naming collision check:** "Settings" does not collide with any existing nav item in `Header.tsx`. If future admin menu added, rename to "Configure".

## Related Code Files

**Modify:**
- `src/components/Header/Header.tsx` — add Dropdown JSX, remove standalone "Add Security Context" button if present.

**Read for context:**
- `src/components/SecurityContext/SecurityContext.tsx` — confirms `useSecurityContext()` API.
- `src/components/Header/brand-block.tsx` — layout reference.
- `src/components/Header/nav-pill.tsx` — layout reference.

**No new files.**

## Implementation Steps

1. Open `Header.tsx`. Locate the Spacer and avatar — the dropdown anchors right before avatar.
2. Import `Menu` / `MenuTrigger` / `Button` from `@cube-dev/ui-kit` (check actual exported names; grep existing usages in repo for the established import pattern).
3. Import `Settings` icon from `lucide-react` (already used in project).
4. Add `<MenuTrigger>` wrapping a `<Button type="clear">Settings ▼</Button>` and a `<Menu>` with two items.
5. Wire `Security Context` item `onAction` → existing modal-open handler from `useSecurityContext()`.
6. Wire `Add to Data Model` item `onAction` → existing rollup-add handler (locate current handler; if it lived on a standalone button, move it).
7. Remove the now-redundant standalone "Add Security Context" button if it lives in `Header.tsx` (audit before delete).
8. Add active-context indicator: if `securityContext` is non-null, render a small dot on the trigger.
9. Run `pnpm tsc --noEmit` (or project compile script) to verify types.
10. Manual smoke: open dropdown → click each item → verify modals open and previous flow unchanged.

## Todo List

- [ ] Audit `Header.tsx` for current Security Context / Rollup button locations
- [ ] Implement Settings dropdown JSX
- [ ] Wire handlers to existing modals
- [ ] Add active-context indicator
- [ ] Remove redundant standalone buttons
- [ ] Type-check
- [ ] Manual smoke test

## Success Criteria

- [ ] Settings dropdown renders right-aligned next to avatar.
- [ ] Both menu items open their respective existing flows without regression.
- [ ] Active security context shows visual indicator on trigger.
- [ ] No standalone Security Context / Rollup buttons remain in top bar.
- [ ] Keyboard navigation works (Tab to trigger, Enter to open, Esc to close).
- [ ] TypeScript compiles clean.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Naming collision ("Settings" vs existing term) | Low | Low | Grep `Header.tsx` + nav components first. Fallback name: "Configure". |
| Rollup entry-point handler isn't in `Header.tsx` (lives elsewhere) | Medium | Low | If handler lives outside Header, leave that entry intact and only add dropdown for Security Context — document deviation in PR. |
| UI-kit Dropdown API differs from antd pattern | Low | Low | Grep existing `MenuTrigger` usages for canonical pattern. |

**Rollback:** Revert single-file change to `Header.tsx`. No state migration. No data impact.

## Next Steps

Unblocks Phase 2 (sidebar settings board) which has zero dependency but lands cleaner after top bar is stable.
