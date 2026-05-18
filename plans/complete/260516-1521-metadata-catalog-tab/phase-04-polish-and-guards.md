---
phase: 4
title: "Polish and Guards"
status: pending
priority: P2
effort: "1d"
dependencies: [1, 2, 3]
---

# Phase 4: Polish and Guards

## Context Links

- Brainstorm: [../reports/metadata-catalog-tab-system-meta.md](../reports/metadata-catalog-tab-system-meta.md) (Security Considerations + Risks sections)

## Overview

Production-readiness pass: PROD-build guard hides the tab and disables the route in `npm run build` artifacts; loading skeletons replace bare `<CubeLoader />`; error/empty states get proper copy and CTAs; refresh button; README + on-page banner document the internal-only posture.

## Priority

P2 — required before the feature is considered shipped, but P3 already delivers full functional value.

## Requirements

### Functional
- **PROD guard:** when `import.meta.env.PROD === true`, the Metadata NavPill is hidden AND the `/metadata` route registration is skipped (or renders a "disabled in production builds" notice). Default behavior; no env var to override.
- **Loading skeletons:** card grid shows N skeleton cards while fetching (don't reuse generic `<CubeLoader />` which centers a single spinner).
- **Error state:** with a clear retry button and human-readable error text (not just `JSON.stringify(err)`).
- **Missing-secret state:** shows what env var to set, links to README section.
- **Empty-results state:** when filters/search yield zero cubes, render "No cubes match" + "Clear all filters" CTA (reuses P2's clear handler).
- **Refresh button:** in page header; re-runs the system-meta fetch and resets local cache.
- **On-page banner:** persistent dismissible banner at top of `/metadata` page: "Internal tool — Cube API secret is embedded in this build. Do not deploy or share."
- **README section:** documents the env var, the dev workflow, and the PROD-guard behavior.

### Non-functional
- Skeleton cards visually match real card dimensions to prevent layout shift.
- All copy proofread; no `console.log`s left behind.

## Key Insights

- The PROD guard is the single most important risk mitigation in the whole plan. Doing it now (vs. retrofit) prevents accidental prod deploy from leaking the secret.
- Banner-dismiss state persists in localStorage (`gds-cube:metadata-banner-dismissed`) to avoid nagging on every load — but the warning still appears on first visit per browser.
- Refresh button forces re-fetch; the in-memory cache from P1 makes this cheap.

## Architecture

```
src/index.tsx
  if (!import.meta.env.PROD) {
    routes.push(<Route key="metadata" path="/metadata" component={MetadataPage} />);
  }

src/components/Header/Header.tsx
  {!import.meta.env.PROD && <NavPill to="/metadata" ...>Metadata</NavPill>}

MetadataPage.tsx
  ├─ <InternalToolBanner /> (dismissible)
  ├─ <PageHeader>
  │   ├─ Title "Metadata Catalog"
  │   └─ <RefreshButton onClick={refresh} loading={loading} />
  ├─ <SearchBar />
  └─ <div flex>
      ├─ <FilterRail />
      └─ {loading && <SkeletonGrid />}
          {error && <ErrorState onRetry={refresh} />}
          {!data && !loading && !error && <MissingSecretState />}
          {data && filtered.length === 0 && <EmptyResultsState onClearFilters={...} />}
          {data && filtered.length > 0 && <CatalogGrid />}
```

## Related Code Files

**Create:**
- `src/pages/Metadata/internal-tool-banner.tsx` — dismissible banner
- `src/pages/Metadata/skeleton-grid.tsx` — N skeleton cards (CSS shimmer)
- `src/pages/Metadata/error-state.tsx`
- `src/pages/Metadata/missing-secret-state.tsx`
- `src/pages/Metadata/empty-results-state.tsx`
- `src/pages/Metadata/refresh-button.tsx`

**Modify:**
- `src/index.tsx` — wrap `/metadata` route in `if (!import.meta.env.PROD)`
- `src/components/Header/Header.tsx` — wrap Metadata NavPill in same guard (desktop + mobile)
- `src/pages/Metadata/MetadataPage.tsx` — render new states, add banner, add refresh button
- `src/hooks/use-system-meta.ts` — expose `refresh()` that bypasses cache
- `README.md` — add "Metadata Catalog" section explaining env var + internal-only posture
- `.env.example` — comment the security warning above the `VITE_CUBE_API_SECRET=` line

## Implementation Steps

1. **PROD guard:**
   - Wrap `<Route key="metadata" …/>` registration in `src/index.tsx` with `import.meta.env.PROD` check.
   - Wrap NavPill in `Header.tsx` (both desktop pill row and mobile dropdown item).
   - Verify with `npm run build && npm run preview` — `/metadata` must 404 / redirect, and pill must be absent.
2. **`skeleton-grid.tsx`:** 8 placeholder cards, same dimensions as real cards, shimmer animation via CSS keyframes.
3. **`error-state.tsx`:** centered card with error icon, message, "Retry" button. Surfaces `error.message` cleanly.
4. **`missing-secret-state.tsx`:** centered card explaining: set `VITE_CUBE_API_SECRET` in `.env.local`, restart dev server. Link to README section anchor.
5. **`empty-results-state.tsx`:** "No cubes match your filters" + "Clear all filters" button (reuses P2 reducer dispatch).
6. **`refresh-button.tsx`:** icon button (refresh icon from `lucide-react`); spinner inside while `loading`.
7. **`internal-tool-banner.tsx`:** sticky banner with warning text + dismiss X. Dismiss writes `gds-cube:metadata-banner-dismissed=1` to localStorage; reads on mount.
8. **Update `use-system-meta.ts`:** ensure `refresh()` clears the module-scoped cache entry and re-fetches.
9. **Wire `MetadataPage.tsx`:** add banner, page header with refresh button, swap state-branch rendering to the new components.
10. **Update `.env.example`:**
    ```
    # Cube API secret — required for the Metadata tab (system-meta endpoint).
    # WARNING: this value ends up in the client JS bundle. The Metadata tab is
    # auto-disabled in production builds (`npm run build`) to mitigate leakage.
    # Use only for internal/localhost dev.
    VITE_CUBE_API_SECRET=
    ```
11. **Update README.md:** new section "Metadata Catalog" explaining env var, internal-only posture, PROD-guard behavior, and the design intent (catalog for DAs).
12. **Final QA:**
    - Dev build: tab visible, full functionality.
    - Prod build: tab absent, route 404s.
    - Without env var: missing-secret state renders.
    - With invalid secret: error-state renders with retry that works after fixing.
    - Refresh button forces re-fetch (verify in Network tab).
    - Banner dismisses and stays dismissed across reloads.

## Todo List

- [ ] Add PROD guard to route registration in `src/index.tsx`
- [ ] Add PROD guard to NavPill in `Header.tsx` (desktop + mobile)
- [ ] Build `skeleton-grid.tsx`
- [ ] Build `error-state.tsx` with retry
- [ ] Build `missing-secret-state.tsx` with README link
- [ ] Build `empty-results-state.tsx` with clear-filters CTA
- [ ] Build `refresh-button.tsx`
- [ ] Build `internal-tool-banner.tsx` with localStorage dismiss
- [ ] Ensure `use-system-meta.refresh()` invalidates cache and re-fetches
- [ ] Wire new states into `MetadataPage.tsx`
- [ ] Update `.env.example` with warning comment
- [ ] Add README "Metadata Catalog" section
- [ ] Final QA on dev + prod builds

## Success Criteria

- [ ] Dev build (`npm run dev`): full feature works, tab visible.
- [ ] Prod build (`npm run build && npm run preview`): NavPill absent; navigating to `/#/metadata` does not render the page; bundle still includes the secret string (acceptable cost) but page is unreachable.
- [ ] Missing-secret state renders correctly when env var is unset.
- [ ] Error state renders with parseable error text and a working retry.
- [ ] Empty-results state renders when filters yield zero matches.
- [ ] Refresh button triggers a new fetch (visible in Network tab).
- [ ] Banner dismisses and stays dismissed; warns again only after localStorage clear.
- [ ] README explains setup, behavior, and the security caveat.
- [ ] No `console.log`s; typecheck clean; lint clean.

## Risk Assessment

- **PROD guard could be bypassed.** Risk: someone removes the guard during a future refactor without realizing. Mitigation: leave a `/* eslint-disable */`-style comment block above the guard explaining WHY the route is gated; add a regression assertion test if testing infra exists.
- **Bundle still contains the secret string even in prod.** Risk: prod bundle includes the env value as dead string even though the route is gated. Mitigation: document explicitly in README — "do not deploy prod build with VITE_CUBE_API_SECRET set"; consider a build-time replace plugin in a future hardening pass.
- **Refresh button thrashing.** Risk: user clicks refresh many times. Mitigation: disable button while `loading`.

## Security Considerations

- This phase is the security-mitigation phase. PROD guard is the primary control; README warning is the documentation control; banner is the runtime UX control. Defense in depth.
- Not addressed (out of scope, document in README): per-user audit logging of who hit the system endpoint, rotation of the API secret, environment separation enforcement.

## Next Steps

Ship. Consider follow-ups: virtualization (>500 cubes), URL-state for filters/drawer (deep-shareable links), refresh-key/last-rebuild metadata in cards, lineage view (cube → source table).
