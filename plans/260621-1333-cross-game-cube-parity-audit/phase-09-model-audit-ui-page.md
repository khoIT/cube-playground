# Phase 9 · Model Audit page (findings · diffs · trend)

**Priority:** P1 (Track B deliverable — the requested UI)
**Status:** pending
**Depends on:** Phase 8 routes/diff API (and Phase 7 data)

## Overview
The visual surface: a top-level **Model Audit** page in the cube-playground app that demonstrates findings clearly, lets users inspect dev↔prod and version-to-version YAML diffs, and shows the trend of findings across runs. Built on the proven `DevAudit` tabbed-shell pattern, fully design-system compliant.

## Key insights
- This is the user's headline ask: "clearly demonstrate findings + keep track of diffs between YAML versions + maintain a diff vs the prod (kraken/cube) workspace." Three tabs map 1:1 to those needs.
- Reuse, don't reinvent: copy the `DevAudit` shell + tab chrome; reuse the chat/ops chart renderer for the trend sparkline if a chart is wanted; mirror Dashboards/Segments page-header pattern.

## Requirements (tabs)
1. **Findings** — landing view is the **all-games heatmap**: rows = ~33 cubes (union), columns = all 8 games, each cell severity-colored via semantic tokens (`--destructive-*`/`--warning-*`/`--success-*`) by that cube×game's worst open finding (empty = clean, hatched = no-counterpart/oracle-less). Filterable by severity/dimension/verdict; click a cell → finding detail drawer: dev value vs oracle value, `file:line`, verdict, and a "view diff" link into the Diffs tab. Run picker (latest / pick a past run) + "Run audit now" button (POST run-audit). Counts header (correctness / parity / cosmetic).
2. **Diffs** — two modes: (a) **Dev ↔ Prod** — pick game+cube, render structured field diff (PK changed X→Y, measure added/removed) + unified text diff; flags cubes with no prod counterpart. (b) **Versions** — pick game+cube + two commits from the history picker; render the diff. Shared diff viewer component.
3. **Upstream** — prod clone status card: local clone sha vs kraken/cube upstream HEAD, behind/ahead, last fetch; "Refresh from kraken/cube" button (POST refresh-prod → `git pull`) with success/failure toast. Lists files that changed on last pull.
4. **Trend** (own tab) — findings-by-severity over the last K runs (line/bar), plus a per-run "newly introduced vs cleared since previous run" delta list. Reuse the chat/ops chart renderer for the series.

## Architecture
- `src/pages/ModelAudit/model-audit-shell.tsx` + `model-audit-tabs.tsx` (clone DevAudit shell), `findings-tab.tsx` (all-games heatmap), `diffs-tab.tsx`, `upstream-tab.tsx`, `trend-tab.tsx`, finding/diff sub-components, `use-model-audit-api.ts` hook.
- Register route alongside DevAudit/DriftCenter in the app router + nav.
- Design: page header per Dashboards/Segments (icon + 20px/700 title, 24px/32px padding, centered maxWidth); all colors/radii/fonts from `tokens.css`; status colors via semantic tokens; no bespoke spacing.

## Related code files
- Create: `src/pages/ModelAudit/*` (shell, tabs, sub-components, hook)
- Edit: app router + nav registration (where `DevAudit`/`DriftCenter` are registered)
- Read (pattern): `src/pages/DevAudit/dev-audit-shell.tsx`, `audit-tabs.tsx`; `src/pages/Dashboards/index.tsx`, `src/pages/Liveops/cohort/index.tsx` (header pattern); `src/theme/tokens.css`; `docs/design-guidelines.md` (MANDATORY before any UI work)
- Consume: Phase 8 routes (`/api/cube-parity/...`)

## Implementation steps
1. Read `docs/design-guidelines.md`; scaffold shell + 4 tabs from the DevAudit pattern.
2. Findings tab: all-games heatmap + filters + detail drawer + run picker + run-now.
3. Diffs tab: shared diff viewer; dev↔prod + versions modes.
4. Upstream tab: clone-status card + git-pull refresh action.
5. Trend tab (series + delta list); register route/nav; cross-check styling against an adjacent page.

## Todo
- [ ] read design-guidelines + scaffold shell/4 tabs
- [ ] Findings tab (all-games heatmap, filters, detail drawer, run picker, run-now)
- [ ] Diffs tab (dev↔prod + versions, shared viewer)
- [ ] Upstream tab (clone status + git-pull refresh)
- [ ] Trend tab (series + per-run delta); route/nav registration; design cross-check

## Success criteria
- Findings heatmap renders all 8 games × cubes from a persisted run; cell color = worst open severity; filters work; cell → drawer shows dev-vs-oracle + file:line.
- Dev↔prod and version diffs render correctly (incl. no-counterpart case).
- Upstream tab flags a behind clone and git-pull refresh updates it.
- Trend tab shows findings-by-severity across runs + newly-introduced/cleared delta.
- Visually indistinguishable in chrome from Dashboards/DevAudit (token audit clean; `npm run lint` theme-token check passes).

## Risks
- Big text diffs / wide heatmap must scroll inside their own `overflow-x:auto` container — page body never scrolls horizontally (design rule).
- All-games heatmap (8 cols × ~33 rows = ~264 cells) is fine to render whole; if it grows, sticky cube-name column + horizontal scroll on the games axis rather than paginating.

## Next
With Track B live, the audit/fix work (Phases 1–6) is conducted THROUGH this console: triage verdicts set in the Findings tab, fixes verified by re-running and watching the trend drop.
