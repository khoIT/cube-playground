# Phase 05 — Frontend Drift Center Page + Nav

## Context
- **DESIGN CONTRACT:** `design/hifi-mockup.html` (rendered: `design/drift-center-mockup.png`) — built via huashu-design, grounded strictly in `docs/design-guidelines.md` + `src/theme/tokens.css`. The React page must match it: header, root-cause group cards, repoint form + live-`/meta` member dropdown, separate detector panel, and the four reference states (prefix-unsupported note, clean/no-drift, viewer read-only, repoint-success). Token-for-token — no raw hex, Inter (`--font-sans`), semantic soft/ink pills (`cube-missing`→destructive, `member-missing`→warning, affected-count→info).
- **MUST follow** `docs/design-guidelines.md` + lessons-learned "Don't introduce experimental visual directions". Copy the page-header recipe from `src/pages/Dashboards/index.tsx` (lines 17-38): `padding:'24px 32px'`, `maxWidth` 800–1200, `margin:'0 auto'`, `fontFamily:'var(--font-sans)'`, icon+20/700 title.
- Reuse coverage-ui primitives: `Pill`, `Mono`, `Note`, `Collapsible`, `GameFilterChips` (`src/pages/Settings/coverage-ui.tsx`).
- Router is **React Router v5** (`Switch`, `component=`, `useHistory`, `exact path`) — register in `src/index.tsx` route block (lines 150-191). Nav is `src/shell/sidebar/sidebar.tsx` via `SidebarSection`/`SidebarItem` gated by `isVisible(id)` (lines 159-181).
- Active game: `useActiveGameId()` from `../../components/Header/use-game-context`.
- API client: `apiFetch` from `src/api/api-client`.
- i18n: nav labels via `t('nav.*')` — add a `nav.driftCenter` key.
- **Live `/meta` members for the repoint picker (D4):** reuse the existing
  `/cube-api/v1/meta?extended=true` proxy (`server/src/routes/cube-proxy.ts:78`) — already
  workspace+game scoped via `x-cube-workspace` / `x-cube-game` headers. Model the fetch on
  `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-meta.ts:101-136` or
  `src/pages/Catalog/use-catalog-meta.ts`. **No new endpoint** — flatten `cubes[].measures[]`
  + `cubes[].dimensions[]` into fully-qualified `cube.member` strings for the picker options.

## Overview
- Priority: P1.
- Status: pending.
- New `/drift-center` page listing root-cause groups for the active game, with per-group repoint + per-metric mark-N/A actions. Nav entry + links from Settings coverage tab and Catalog drift strip.

## Data flow
- IN: `useActiveGameId()` → `GET /api/business-metrics/drift-center?game=<id>` → `{ groups[], detectorPanel, prefixUnsupported, generatedAt }`. Also fetch live `/meta` members (reused proxy, D4) for the repoint picker.
- TRANSFORM:
  - If `prefixUnsupported === true`: render a single `Note` — *"Drift not meaningful for this workspace without ref translation (v1.5)."* Skip the group list (no wall of false cube-missing).
  - Else render `groups[]` (cube-missing / member-missing / unparseable) as `Collapsible` cards with `affectedCount` + affected metric ids; per group a Repoint control (`from` prefilled → `to` chosen from a **searchable dropdown of live `/meta` members**, target re-validated server-side as a backstop); per metric a Mark-N/A toggle.
  - Render `detectorPanel` as a SEPARATE "Last detector run saw" block below the live groups (D3 — no merge).
- OUT: PATCH `/repoint` or `/applicability` → refetch on success (mirror `use-metric-coverage.ts` scaffold→refetch).

## Requirements
### Functional
1. New page `src/pages/DriftCenter/index.tsx` (header recipe verbatim, icon e.g. `AlertTriangle`/`GitBranch` from lucide).
2. Hook `src/pages/DriftCenter/use-drift-center.ts` (fetch drift + fetch live `/meta` members + repoint + markNA + refetch), modeled on `use-metric-coverage.ts`. Expose `prefixUnsupported`, `detectorPanel`, and a `members: string[]` list (fully-qualified `cube.member`) for the picker.
3. Components (each < 200 lines, kebab-case):
   - `drift-group-card.tsx` — one root-cause group (Collapsible + affected metrics + Pill for reason).
   - `repoint-ref-form.tsx` — `from`(prefilled) → `to` chosen from a **searchable dropdown of live `/meta` members** (`members` from the hook); submit; error display. No free-text member entry.
   - `mark-na-toggle.tsx` — per-metric N/A toggle for the active game.
   - `detector-run-panel.tsx` — separate "Last detector run saw" block (renders `detectorPanel`).
4. Route in `src/index.tsx`: `<Route key="drift-center" exact path="/drift-center" component={DriftCenterPage} />` (lazy-import like siblings).
5. Nav: add a `SidebarSection`/`SidebarItem` (flat) gated by `isVisible('driftCenter')`; register the id in the nav-visibility list (`use-visible-nav-items.ts` + `nav-visibility-section.tsx`).
6. Link-ins:
   - Settings `metric-coverage-section.tsx` — add a "Open Drift Center" link.
   - Catalog `drift-summary-strip.tsx` — make the strip link to `/drift-center`.

### Non-functional
- Tokens only (no raw hex); semantic soft/ink pills for reason states.
- Repoint/mark-N/A buttons hidden or disabled for `viewer` role (read role from security context; server still 403s as defense-in-depth). Check how existing mutating UI (e.g. dashboards create) gates on role — reuse that pattern.
- Empty state ("No drift for <game> 🎉") and error state.

## Related code files
- Create: `src/pages/DriftCenter/index.tsx`, `use-drift-center.ts`, `drift-group-card.tsx`, `repoint-ref-form.tsx`, `mark-na-toggle.tsx`, `detector-run-panel.tsx`.
- Read for member-picker reuse: `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-meta.ts`, `src/pages/Catalog/use-catalog-meta.ts` (live `/meta?extended=true` fetch pattern).
- Modify: `src/index.tsx` (route), `src/shell/sidebar/sidebar.tsx` (nav), `src/pages/Settings/use-visible-nav-items.ts` + `nav-visibility-section.tsx` (visibility id), `src/pages/Settings/metric-coverage-section.tsx` (link), `src/pages/Catalog/metrics-tab/drift-summary-strip.tsx` (link), i18n nav file (`nav.driftCenter`).
- Read for context: `src/pages/Dashboards/index.tsx`, `coverage-ui.tsx`, `use-metric-coverage.ts`.

## Implementation steps
1. Build the hook (fetch drift + fetch live `/meta` members + repoint/markNA/refetch).
2. Build the page header + game-scoped fetch + empty/error/loading states + `prefixUnsupported` note path.
3. Build `drift-group-card` → compose `repoint-ref-form` (member dropdown) + `mark-na-toggle`; build `detector-run-panel`.
4. Register route + lazy import.
5. Add nav section + visibility id + i18n key.
6. Add link-ins from Settings + Catalog.
7. `npm run typecheck` + `npm run build`.
8. Cross-check against Dashboards/Cohort for typography/padding/radius drift.

## Todo
- [ ] `use-drift-center.ts` (drift + live `/meta` members + mutations)
- [ ] `index.tsx` (header recipe verbatim; `prefixUnsupported` note path)
- [ ] `drift-group-card.tsx`
- [ ] `repoint-ref-form.tsx` (searchable dropdown of live `/meta` members, no free text)
- [ ] `mark-na-toggle.tsx`
- [ ] `detector-run-panel.tsx` (separate detector block)
- [ ] route in `index.tsx` (lazy)
- [ ] nav section + visibility id + `nav.driftCenter`
- [ ] link-ins (Settings + Catalog)
- [ ] role-gate mutating controls
- [ ] typecheck + build pass
- [ ] visual cross-check vs Dashboards

## Success criteria
- `/drift-center` renders root-cause cards for the **active game only** using only tokens; matches Dashboards header.
- Repoint dropdown lists only real live `/meta` members (`cube.member`); picking one + submit updates the YAML and the group disappears on refetch.
- Mark-N/A removes a metric's group for that game on refetch.
- Switching active game re-fetches and re-scopes (drift + member list).
- Switching to a `prefix` workspace shows the one-line "drift not meaningful (v1.5)" note, NOT a wall of cube-missing.
- `detector-run-panel` shows separately; it is not merged into the live groups.
- viewer sees read-only (no repoint/mark buttons); editor/admin see actions.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| New page drifts from design system (serif/bespoke) | M×H | Copy header recipe verbatim; reuse coverage-ui; cross-check vs Dashboards before shipping (lessons-learned rule). |
| FE fetches `/meta` per game and stalls page | M×M | Page is game-scoped (one game's fetch); all-games view deferred to v1.5. The drift GET and the member-picker `/meta` fetch hit the same workspace+game ctx — can dedupe later. |
| Member picker reinvents a `/meta` fetcher (DRY) | M×M | Reuse the `use-new-metric-meta` / `use-catalog-meta` fetch pattern (proxy `/cube-api/v1/meta?extended=true`); do not add a new endpoint. |
| Picker offers a member that `/meta` dropped between fetch & submit | L×M | Server backstop re-validates `to` (phase-03) → 400; surface the error in `repoint-ref-form`. |
| Role gating done only client-side | L×M | Server gate is authoritative (phase-03); FE gate is UX-only. |
| `isVisible`/nav-visibility id not registered → section never shows | M×M | Enumerate the two files that own visibility (`use-visible-nav-items.ts`, `nav-visibility-section.tsx`); add id to both. |

## Security
- Mutations gated server-side (phase-03). FE hides controls for viewer for UX, not security.

## Next
- Phase 06 tests page + endpoints + bridge.

## Decided
- **Active game only** for v1 (D1); all-games overview is v1.5.
- **Repoint = searchable dropdown of live `/meta` members** via the reused `/cube-api/v1/meta?extended=true` proxy (D4); no new endpoint, no free-text member entry.
- **Separate detector panel** (D3); **`prefixUnsupported` note** for prefix workspaces (D1).

## Unresolved
None.
