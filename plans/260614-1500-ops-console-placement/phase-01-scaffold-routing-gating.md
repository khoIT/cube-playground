---
phase: 1
title: "Page scaffold + routing + gating + tab shell"
status: completed
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Page scaffold + routing + gating + tab shell

## Overview
Stand up the `/ops` page skeleton: route, sidebar nav, cfm/jus gating, the 3-tab IA
(Overview / Members / Care), and the window-toggle state. Tabs render stubs; no data yet.
This is the frame every later phase fills.

## Requirements
- Functional: navigating to `/ops` renders the Ops Console for cfm/jus; sidebar shows an "Ops" item
  for those games only; tab switching works; window toggle (7d/30d/MTD) holds state and is readable by
  the Overview tab. A non-cfm/jus game shows an "Ops not available for {game}" empty state and no nav item.
- Non-functional: matches the page-header pattern + design tokens; no new bespoke spacing.

## Architecture
New page module `src/pages/OpsConsole/` (kebab-case files). `index.tsx` exports `OpsConsolePage`:
- reads `const {gameId, ready} = useGameContext()`. **Gate order (red-team B4):** `if (!ready) return
  <Loading/>` FIRST (gameId defaults to `'ballistar'` and is corrected async — never render/fire queries
  on the default); then `if (!['cfm','jus'].includes(gameId))` render the unavailable state.
- page header (icon + eyebrow "Ops · Monetization + Identity" + 20px/700 "Ops Console") + game chip +
  window toggle (segmented control) in `head-right`.
- tab bar: Overview | Members | Care; active tab in local state (or `?tab=` query param for deep-link).
  **Inactive tabs UNMOUNT** (do not display:none) so the Care tab's 30s activity poll stops when away
  (red-team B3).
- window in local state (default `'30d'`), passed as prop to Overview.
- Tab bodies: `overview-tab.tsx`, `members-tab.tsx` (uid search + link), `care-tab.tsx` (embed) — Phase 1
  ships stub bodies.

**Nav gating (red-team B2 — `showSection('ops')` will NOT compile):** `NavItemId` and `FeatureKey` are
closed unions mirrored server-side; there is no `'ops'` member. Do NOT invent an 'ops' feature key. Add
the nav item under the existing `dashboards` section, gated
`showSection('dashboards') && ['cfm','jus'].includes(gameId)` (mirror the CS sub-item, sidebar.tsx:217).

## Related Code Files
- Create: `src/pages/OpsConsole/index.tsx`, `ops-console-tabs.tsx` (tab bar), `overview-tab.tsx`,
  `members-tab.tsx`, `care-tab.tsx` (stubs), `ops-window-toggle.tsx`.
- Modify: `src/index.tsx` (loadable import + `<Route exact path="/ops">`), `src/shell/sidebar/sidebar.tsx`
  (add `<SidebarSection id="ops" to="/ops">` gated by `showSection('ops')` + cfm/jus).
- Reference: `src/pages/Dashboards/cs/index.tsx` (header + page-style pattern),
  `src/pages/Liveops/cohort/index.tsx` (grid header), `src/components/Header/use-game-context.ts`.

## Implementation Steps
1. Create `src/pages/OpsConsole/index.tsx` with `OpsConsolePage` — game gate + header + window state +
   tab state; render the active tab component.
2. Build `ops-console-tabs.tsx` (tab bar matching the mockup: Overview / Members (member360) / Care
   (playbooks)) and `ops-window-toggle.tsx` (segmented 7d/30d/MTD).
3. Stub `overview-tab.tsx`, `members-tab.tsx`, `care-tab.tsx`.
4. Register the route in `src/index.tsx` (loadable, lazy) following the existing CS-route pattern.
5. Add the sidebar nav item under the `dashboards` section gated `showSection('dashboards') &&
   ['cfm','jus'].includes(gameId)` (NO new feature key — B2).
6. Compile-check (`tsc` / build) — fix errors (the closed-union gotcha surfaces here).

## Success Criteria
- [ ] `/ops` renders for cfm and jus; correct header + tabs + window toggle.
- [ ] Renders Loading until `ready`; never fires/render-gates on the `'ballistar'` default (B4).
- [ ] Non-cfm/jus game → unavailable empty state, no sidebar item.
- [ ] Tab switch unmounts the previous tab; window toggle updates state; deep-link `?tab=members` works.
- [ ] No new tsc/lint/build errors; tokens-only styling; header matches an adjacent page.

## Risk Assessment
- `showSection('ops')` / `hasFeature('ops')` do NOT compile (closed `NavItemId`/`FeatureKey` unions,
  server-mirrored) — use the `dashboards` section gate; a real top-level section would need a two-stack
  FeatureKey addition (own task), not done here.
- ready-race: gate on `ready` first; gameId defaults to `'ballistar'`.
- Deep-link tab param is optional (YAGNI) — include only if cheap with the existing router.
