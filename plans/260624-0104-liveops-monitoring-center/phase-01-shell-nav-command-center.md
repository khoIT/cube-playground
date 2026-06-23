# Phase 01 — LiveOps shell, nav revival, Command Center

**Priority:** P0 · **Status:** ☐ · Depends: 00

## Goal
Stand up the LiveOps center IA: restructured nav, hub routing + tab scaffold, and the **Command Center**
landing (KPI strip + high-sev anomaly strip + absorbed Ops overview trends). Keep old routes working via alias.

## Key insights (from scout)
- Nav already renders (`shell/sidebar/sidebar.tsx:176`) and feature defaults ON; restructure + ensure-visible, don't "un-bury".
- `OpsConsole/ops-console-tabs.tsx` is the hub-tab pattern to reuse for Diagnostics/Alerts.
- Command Center reuses `Liveops/kpi-hero-strip.tsx`, `anomaly-high-severity-strip.tsx`, and lifts `OpsConsole/overview-trends.tsx` (per Phase 00 verdict).

## Architecture
- New nav children under the LiveOps `SidebarSection`: Command Center (`/liveops`), Diagnostics, Monetization, Retention, Alerts & Digests.
- Routing in `src/index.tsx` (~258-261): add `/liveops/diagnostics`, `/liveops/monetization`, `/liveops/retention`, `/liveops/alerts`. **Redirect** `/liveops/cohort`→`/liveops/retention`, `/liveops/anomalies`→`/liveops/alerts?tab=inbox` (keep deep links alive).
- New `Liveops/_hub/liveops-tabs.tsx` (generalize OpsConsoleTabs; `?tab=` query-driven so anomaly deep-links survive).
- Command Center = revamp of `Liveops/index.tsx`: KPI hero strip + anomaly strip + Ops overview trends section + (Phase 07) portfolio row slot.

## Files
- Modify: `src/index.tsx` (routes + redirects), `src/shell/sidebar/sidebar.tsx` (nav children), `src/pages/Settings/use-visible-nav-items.ts` (register new ids if sub-items toggleable), `src/pages/Liveops/index.tsx` (Command Center compose).
- Create: `src/pages/Liveops/_hub/liveops-tabs.tsx`, `src/pages/Liveops/_hub/use-liveops-tab.ts`, `src/pages/Liveops/command-center/ops-overview-section.tsx` (wraps lifted trend queries).
- Keep: `kpi-hero-strip.tsx`, `anomaly-high-severity-strip.tsx`, `cohort/`, `anomaly-inbox/` (relocated by route, not rewritten).

## Steps
1. Add LiveOps nav children + i18n labels (`t('nav.*')`). Ensure section shown (visibility self-check per Phase 00 verdict).
2. Add hub routes + alias redirects in `src/index.tsx`; lazy-load new pages.
3. Build `liveops-tabs.tsx` (query-param driven, icon+label, design-token styled).
4. Compose Command Center: KPI strip + anomaly strip + `ops-overview-section` (game-scoped trends lifted from OpsConsole). Add empty portfolio-row placeholder (filled Phase 07).
5. Cross-check against `Dashboards/index.tsx` header pattern (24px/32px, icon+20px/700 title, eyebrow).

## Success criteria
- [ ] LiveOps nav shows 5 children; section visible after migration.
- [ ] `/liveops/{diagnostics,monetization,retention,alerts}` route; `/liveops/cohort` & `/liveops/anomalies` redirect with query preserved.
- [ ] Command Center renders KPI strip + anomaly strip + Ops overview trends, no regressions on existing tiles.
- [ ] Tab component reused by later hubs (no per-hub bespoke tab CSS).
- [ ] `npm run build` / typecheck clean.

## Risks
- Anomaly deep-links (`?metric=`,`?severity=`) must survive the `/liveops/anomalies`→`/liveops/alerts` redirect — preserve query string.
- Two "overview" surfaces (Command Center vs /ops Overview) — absorb, don't duplicate; /ops Overview can later thin to a redirect (out of scope v1).
