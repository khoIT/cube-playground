# Phase 1 — Main flow + remove header search bar

## Overview

- **Priority:** P0 (blocks Phase 2 layout)
- **Status:** pending
- Trim the header right-cluster so it stops carrying a redundant input. ⌘K already opens the real `SmartSearchOverlay` from `SmartSearchProvider`. The header `SearchBox` only steals focus and shows a kbd hint — net negative.
- Confirm `IndexPage` still resolves correctly to `/build` in our prod-style backend (no `/playground/files` endpoint).

## Key insights

- `Header/search-box.tsx` is a focus-trap for ⌘K but does not own the actual overlay. Removal is safe.
- `SmartSearchProvider` registers its own ⌘K listener at provider level (already in `App.tsx`). No coupling.
- `IndexPage` falls into the `setFiles([])` branch when `/playground/files` 404s → `push('/schema')` → `/schema` then redirects to `/catalog/models`. Wrong target per user choice ("Playground"). Need to short-circuit to `/build` in fallback mode.

## Requirements

- Header has no search input on desktop or mobile.
- ⌘K still toggles `SmartSearchOverlay` from anywhere.
- `/` lands on `/build` in this app's bootstrap mode.
- No layout shift introduced — right-cluster reflows cleanly.

## Architecture

- `RightCluster` keeps `HelpButton`, `NotificationBell`, `UserMenu`. Search component removed.
- `i18n` keys `search.placeholder` / `search.shortcut` may still be referenced by overlay — leave intact.
- `IndexPage` collapses files-probing into a fast path: if `fetch('playground/files')` 404s within ~200ms or returns error, push `/build`. Keep the dev-mode branch behind a feature check.

## Related code files

**Modify**
- `src/components/Header/right-cluster.tsx` — drop `<SearchBox />`.
- `src/pages/Index/IndexPage.tsx` — prefer `/build` when files endpoint absent.

**Delete**
- `src/components/Header/search-box.tsx` — kept files policy says no, but this component has zero consumers outside `right-cluster`. Mark deprecated via header comment instead; do not delete in this PR.

**Read for context**
- `src/App.tsx`
- `src/shared/smart-search/smart-search-context.tsx`

## Implementation steps

1. Remove the `<SearchBox />` import + JSX from `right-cluster.tsx`. Verify `Wrap` gap still looks right (3 items vs 4).
2. Add a deprecation header comment to `search-box.tsx` noting it is unused.
3. In `IndexPage.tsx`: when `/playground/files` 404s or rejects, push `/build` (not `/schema`). Keep dev-server branch for true Cube dev mode.
4. Run `npm run typecheck`.

## Todo

- [ ] Remove search-box JSX from right-cluster
- [ ] Add deprecated comment to search-box.tsx
- [ ] Update IndexPage fallback target
- [ ] typecheck passes

## Success criteria

- Header has only Help / Bell / User on desktop.
- Cold load on `/` lands at `/#/build`.
- ⌘K still opens SmartSearchOverlay.

## Risks

- Existing Header test `__tests__/right-cluster.test.tsx` (if any) may assert on search slot — update accordingly.
- Mobile layout: confirm `RightCluster` is not currently rendered on mobile (Header guards on `isDesktopOrLaptop`).

## Security considerations

None.
