---
phase: 1
title: "UI redesign with huashu-design"
status: pending
priority: P1
effort: "3-4d"
dependencies: []
---

# Phase 1: UI redesign with huashu-design

## Overview

Use the `huashu-design` skill (HTML/CSS prototyping + design-direction guidance) to produce hi-fi mockups for three surfaces (`/liveops`, `/liveops/anomalies`, `/liveops/cohort`), then port the winning direction into the existing React components. Goal: the demo should land as **"a real ops console"**, not "a query playground with charts pinned to the top."

## Why this matters

Phase 1 of the original pack reused Segments visuals (`<KpiTile>`, `<Sparkline>`, `<LiveBadge>`) verbatim. Result: components that read as Segments-page widgets crammed onto a route. The wins available without rewriting any data layer:
- Information density — current strip wastes vertical space; sparklines could share the tile chrome.
- Anomaly inbox — rows look like a generic list, not a triage queue. Severity should dominate the visual hierarchy.
- Cohort grid — colored cells work, but the page has no narrative framing ("you're looking at install_date × N-day retention"). Tooltips fight WCAG.

## Requirements

**Functional**
- Three pages redesigned without changing route URLs or data contracts:
  - `/liveops` — hero strip (5 tiles + sparklines) + high-severity strip + nav to cohort/anomalies
  - `/liveops/anomalies` — triage queue, severity-first hierarchy, ack/snooze/open-in-playground actions stay
  - `/liveops/cohort` — heatmap with clearer narrative + window selector + export
- Visual feedback states preserved: `LiveBadge` (last refresh), gap-tile "—", schema-drift hint
- Accessibility — WCAG-AA contrast, keyboard nav for ack/snooze, focus rings, tooltip reachable via keyboard

**Non-functional**
- No new runtime deps. Use existing tokens (`src/theme/tokens.css`) + Tailwind utility classes already in tree.
- Bundle size delta < 10 KB gz.
- No regression in existing Phase 1-2 tests; if visual changes need ARIA updates, snapshot tests update accordingly.

## Architecture

Two-pass workflow:

### Pass A — Design direction (huashu-design)
Use the skill to produce **3 design directions** as standalone HTML mockups:
1. **Editorial** — light, generous whitespace, type-driven hierarchy
2. **Operational** — dense, monospaced numerics, traffic-signal colors
3. **Cinematic** — high-contrast hero with subdued supporting cards

Score against:
- Information density (how many KPIs fit before scroll)
- Severity legibility (can ops triage at a glance)
- Brand fit (cube-playground is internal/ops-leaning)

Pick ONE direction with the user. Output: 3 self-contained HTML files in `plans/260526-0239-liveops-polish-and-caching/visuals/{editorial,operational,cinematic}/index.html`.

### Pass B — Port to React
Port the chosen direction into:
- `src/pages/Liveops/index.tsx` (layout shell)
- `src/pages/Liveops/kpi-hero-strip.tsx` (tile layout)
- `src/pages/Segments/visuals/kpi-tile.tsx` (only if direction demands tile-level changes — risky, see Risks)
- `src/pages/Liveops/anomaly-inbox/anomaly-row.tsx` + `index.tsx`
- `src/pages/Liveops/cohort/cohort-grid.tsx` + `index.tsx`

Add new utility components where natural (e.g. `<SeverityBadge>`, `<MetricNumeric>`, `<CohortLegend>`) under `src/pages/Liveops/_ui/`.

## Related Code Files

- **Create**
  - `plans/260526-0239-liveops-polish-and-caching/visuals/editorial/index.html`
  - `plans/260526-0239-liveops-polish-and-caching/visuals/operational/index.html`
  - `plans/260526-0239-liveops-polish-and-caching/visuals/cinematic/index.html`
  - `src/pages/Liveops/_ui/severity-badge.tsx` (and similar small primitives — only as needed by the chosen direction)
- **Modify** (after direction picked)
  - `src/pages/Liveops/index.tsx`
  - `src/pages/Liveops/kpi-hero-strip.tsx`
  - `src/pages/Liveops/anomaly-inbox/index.tsx`
  - `src/pages/Liveops/anomaly-inbox/anomaly-row.tsx`
  - `src/pages/Liveops/cohort/index.tsx`
  - `src/pages/Liveops/cohort/cohort-grid.tsx`
  - `src/theme/tokens.css` — add tokens the direction needs (severity hues, density variants)
- **Reuse (do not edit)** unless the direction forces it
  - `src/pages/Segments/visuals/kpi-tile.tsx` — touching this risks regressing Segments UI

## Implementation Steps

1. Run huashu-design with the brief: "internal liveops console, replaces a query playground; primary user = data-platform ops + analysts; 3 surfaces". Output 3 directions as HTML mockups.
2. Present mockups to user via `AskUserQuestion` with side-by-side preview. Pick one. Document the choice in this file's "Outcome" section.
3. Token additions in `tokens.css` to support the direction (severity colors, density modifiers).
4. Build `src/pages/Liveops/_ui/` primitives (only what's new — don't recreate KpiTile if the direction reuses it).
5. Port layout shell first (`/liveops` index), confirm hero strip renders the new way.
6. Port anomaly inbox row + page.
7. Port cohort grid + page.
8. Visual regression — run existing tests, update ARIA/snapshot tests where intentional.
9. Manual a11y pass — keyboard nav through ack/snooze, screenshot at 1440x900 + 1366x768 + 375x812.

## Success Criteria

- [ ] 3 HTML mockup directions delivered + user picks one.
- [ ] `/liveops`, `/liveops/anomalies`, `/liveops/cohort` ported to the chosen direction.
- [ ] All Phase 1-2 unit tests still pass.
- [ ] No regression in Segments page (proven by re-running `npx vitest run src/pages/Segments`).
- [ ] WCAG-AA contrast verified for: severity badges, cohort cells, KPI numerics.
- [ ] Bundle size delta ≤ 10 KB gz.
- [ ] Screenshots captured into `plans/.../visuals/after/` for the changelog.

## Risk Assessment

- **Risk:** chosen direction wants a different `<KpiTile>` chrome → edit risks Segments regression.
  **Mitigation:** if change needed, fork into `src/pages/Liveops/_ui/liveops-tile.tsx` instead of editing Segments visual.
- **Risk:** scope creep into "redesign the whole app".
  **Mitigation:** scope is the 3 routes only. Sidebar/topbar stay.
- **Risk:** huashu-design produces beautiful mockups that ignore data shapes (e.g. KPI strip with 8 tiles when we have 5).
  **Mitigation:** Pass A prompt must include the actual data shape — number of tiles, severity values, cohort grid dimensions.
