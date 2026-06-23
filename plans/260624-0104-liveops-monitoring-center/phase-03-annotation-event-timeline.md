# Phase 03 — Shared annotation primitive + Event timeline (Diagnostics tab 2)

**Priority:** P1 · **Status:** ☐ · Depends: 01

## Goal
A shared "event annotation" layer (patches / events / campaigns / incidents) that overlays markers on
ANY trend chart, plus the Diagnostics Event-timeline tab (mockup tab 2). Annotation calendar is the
reusable bit — same overlay later rides Command Center + Monetization charts.

## Key insights
- No chart-annotation concept exists today (DevAudit turn-annotation is unrelated).
- Build the data layer + a reusable overlay first; the Timeline tab is one consumer.
- Reuse `assistant-chart-section.tsx` (recharts) — add optional `annotations` prop → render `ReferenceLine`/`ReferenceArea` + flag markers. `OverviewTrends` data shape is the template.

## Architecture
- New table (segments.db migration `069-chart-annotations.sql`): id, game (nullable=global), type(patch|event|campaign|incident), title, starts_at, ends_at(null), url, created_by, created_at. (Migration filename = domain slug only.)
- Backend CRUD `server/src/routes/annotations.ts`: GET (by game+range), POST, PATCH, DELETE.
- FE: `src/components/charts/annotation-overlay.tsx` (consumed by AssistantChartSection via prop); `useChartAnnotations(game, range)` hook.
- Diagnostics Timeline tab: trend line + flags + event-detail side panel + type filter chips (mockup) + inline "add event" form.

## Files
- Create: `server/src/db/migrations/069-chart-annotations.sql`, `server/src/routes/annotations.ts`, `server/src/services/annotation-store.ts`.
- Create: `src/components/charts/annotation-overlay.tsx`, `src/api/chart-annotations.ts`, `src/hooks/use-chart-annotations.ts`.
- Create: `src/pages/Liveops/diagnostics/timeline/event-timeline-view.tsx`, `.../timeline/event-detail-panel.tsx`, `.../timeline/event-editor.tsx`.
- Modify: `src/pages/Chat/components/assistant-chart-section.tsx` (optional `annotations` prop, additive/back-compat).

## Steps
1. Migration + store + CRUD routes; seed a few cfm_vn events for demo.
2. `annotation-overlay` + hook; thread optional `annotations` prop through AssistantChartSection (no behavior change when omitted).
3. Timeline view: DAU line + clickable flags + detail panel + type-filter chips + add/edit event form.
4. Retrofit Command Center trends to pass annotations (cheap, high payoff).
5. Cross-link: Delta-decomposition top driver → "matches event X" when a same-window annotation exists.

## Success criteria
- [ ] Annotations CRUD persists; overlay renders on the Timeline chart with correct positions + type colors.
- [ ] `AssistantChartSection` unchanged when `annotations` omitted (existing charts unaffected).
- [ ] Command Center trends show the same overlay.
- [ ] Add/edit/delete event works from the UI; global (game=null) events show across games.

## Risks
- Annotation source is manual entry in v1; later auto-ingest (patch notes, campaign feed) is out of scope — `log`/note it.
- recharts ReferenceLine on time axis needs matching x-scale (category vs time) — verify against the chosen chart encoding.
