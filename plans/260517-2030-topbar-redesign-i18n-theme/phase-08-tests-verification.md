---
phase: 8
title: "Tests + verification"
status: completed
priority: P1
effort: "3h"
dependencies: [1, 2, 3, 4, 5, 6, 7]
---

# Phase 8: Tests + verification

## Overview

Add unit + integration coverage for the header refactor, theme + i18n contexts, catalog tab routing, and manual smoke pass across light + dark + EN + VN.

## Requirements
- Functional: header pills navigate; mobile dropdown matches; user-menu dispatches the right actions; theme + lang persist across reload; catalog tabs flip URL; `/schema` redirects.
- Non-functional: `npm run test` green; `npm run typecheck` clean; `npm run build` clean.

## Architecture
- Use existing `vitest` setup (already in repo per README). React Testing Library is the established stack (cube-playground already uses it in test files we saw).
- New test files mirror new source files (one `__tests__` folder per feature area).

## Related Code Files
- Create:
  - `src/components/Header/__tests__/Header.test.tsx`
  - `src/components/Header/__tests__/user-menu.test.tsx`
  - `src/theme/__tests__/ThemeContext.test.tsx`
  - `src/i18n/__tests__/i18n-init.test.ts`
  - `src/pages/Catalog/__tests__/catalog-tabs.test.tsx`
  - `src/pages/Catalog/__tests__/schema-redirect.test.tsx`
- Modify: README.md (refresh Routes section after `/schema` → `/catalog/models` redirect)

## Implementation Steps
1. `Header.test.tsx` — render with `MemoryRouter` at `/build`, assert three pills present; switch route to `/metrics/new` and `/catalog/models` and assert active pill.
2. `user-menu.test.tsx` — render with mocked theme + lang + security context, click each menu item, assert: `setTheme` called with toggled value, `setLang` called, security-context `setIsModalOpen(true)` called, `LEGACY_NEW_METRIC_EVENT` dispatched, rollup `toggleModal` called.
3. `ThemeContext.test.tsx` — provider sets `document.documentElement.dataset.theme`; `toggle()` flips and persists to LS.
4. `i18n-init.test.ts` — init returns instance with `en` + `vi` resources; `changeLanguage('vi')` updates `t('nav.playground')` to Vietnamese value.
5. `catalog-tabs.test.tsx` — render at `/catalog` shows Catalog active; at `/catalog/models` shows Models active; clicking switch triggers `history.push`.
6. `schema-redirect.test.tsx` — render the app at `/schema` (`MemoryRouter initialEntries={['/schema']}`); assert location ends up at `/catalog/models`.
7. Run `npm run test`, `npm run typecheck`, `npm run build`.
8. Manual smoke matrix: { light, dark } × { EN, VN } × { /build, /metrics/new, /catalog, /catalog/models, /metric/:cube/:member }. Eyeball each combination for legibility + correct strings.
9. Update README Routes table + Auth section if relevant.

## Success Criteria
- [ ] All unit tests pass.
- [ ] `npm run typecheck` clean.
- [ ] `npm run build` clean.
- [ ] Manual smoke matrix passes (20 combinations).
- [ ] README updated (routes + new env / dependency notes if applicable).

## Risk Assessment
- Vitest + RTL setup already exists per repo. New tests use the same imports and helpers as `src/pages/Catalog/__tests__/cube-card.test.tsx` etc.
- The smoke matrix is manual eyeball; some token gaps in dark mode (charts, metric-card-styles) are pre-known and accepted (see phase 1 risk note).

## Security Considerations
- None.

## Next Steps
- Plan terminates. If smoke catches dark-mode contrast issues, file follow-up ticket — out of scope for this plan.

## Open questions / Unresolved
- None. All four decision points locked via AskUserQuestion in the brainstorm.
