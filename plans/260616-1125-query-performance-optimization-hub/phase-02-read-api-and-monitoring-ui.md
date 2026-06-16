# Phase 02 — Read API + monitoring UI

## Context
- Route pattern: `server/src/routes/preagg-runs.ts:27-29` (admin preHandlers), register in `server/src/index.ts` (import ~59, register ~104-117 block).
- UI tab: `src/pages/Admin/hub/index.tsx:38-59` (`buildAdminTabs`) + Switch (~120-172); `src/shell/tab-shell.tsx`.
- Data hook: `src/pages/Admin/hub/preagg-runs-data.ts:72-117` (`apiFetch` + 60s poll).
- Reusable UI: status Pill (`preagg-runs-tab.tsx:158-188`), KPI card (244-279), expandable row (642-654 + `preagg-runs-sweep-row.tsx`). Tokens: `src/theme/tokens.css`. Design rules: `docs/design-guidelines.md`.

**Priority:** P1. **Status:** pending. **Depends on:** P1 (table + store).

## UI Design Gate (huashu — MANDATORY, run FIRST)
This is a net-new admin page **and** the P5 action panel — both are "important/new UI surfaces", so the huashu-design step is required before writing any React.

1. Invoke the `huashu-design` skill to produce hi-fi HTML variants of the hub: KPI strip + prominent **Failures** section + **default-closed expandable Successful-queries** list + the per-query row (status pill, latency, preagg-hit badge, member-name chips) + the P5 "Optimize →" action affordance/panel. Variants must use `src/theme/tokens.css` tokens and mirror `preagg-runs-tab.tsx` so they read as part of the existing design system (design-guidelines §3/§6).
2. **Surface the design-direction question to the user** via `AskUserQuestion` — present the variants and let them pick/mix before any React is written. Do not proceed to implementation on assumed direction.
3. Only after the user picks/mixes → build the React below against the chosen variant.

Skip ONLY if the user explicitly waives it for this surface. Save variant HTML under this plan dir's `visuals/`.

## Read API — `server/src/routes/query-perf.ts`
Admin-gated (copy preHandlers from preagg-runs.ts:28-29). Endpoints:
- `GET /api/query-perf/failures?since=&limit=` — non-200 rows (status >= 400 OR class fail), newest first. The actionable list.
- `GET /api/query-perf/recent?since=&limit=` — 200 rows for the collapsed success list (default-closed in UI, so fetch on expand / lazily).
- `GET /api/query-perf/summary?since=` — KPI rollups: total queries, fail count, p50/p95 latency, fallthrough count, slow (>SLOW_MS) count. Computed in SQL (`COUNT`, `AVG`, percentile via ordered window or approximate) over the window.
- All return `query_shape` parsed back via `parseQueryShape`; each row carries `preagg_hit` (NULL until P3 lands — UI shows "—" / "unknown" pre-P3).
- Register in `server/src/index.ts`: `import queryPerfRoutes from './routes/query-perf.js';` (~59) + `await app.register(queryPerfRoutes);` (~117).

## UI — new tab `/admin/query-perf`
Mirror preagg-runs structure exactly. Files:
- `src/pages/Admin/hub/query-perf-tab.tsx` — page body.
- `src/pages/Admin/hub/query-perf-data.ts` — `useQueryPerfSummary`, `useQueryPerfFailures`, `useQueryPerfRecent` (apiFetch + 60s poll, copy `usePreaggRuns` shape 72-100).
- `src/pages/Admin/hub/query-perf-row.tsx` — per-query row (status pill, latency, preagg-hit badge, query-shape member chips).
- Register tab in `buildAdminTabs` (index.tsx:38-59): `{ key: 'query-perf', label: 'Query Performance', path: '/admin/query-perf' }`, optional `tag` = failure count when >0 (mirror the "N pending"/"N alert" badge pattern at 45/55). Add `<Route path="/admin/query-perf">` to the Switch + import the tab.

### Layout (two sections, explicit requirement)
1. **KPI strip** — member-360 tile pattern (design-guidelines §6b KPI tiles): Total queries, Failures (destructive-ink when >0), p95 latency, Trino-fallthrough count, Slow (>3s) count. `tabular-nums`.
2. **Failures section (prominent, top)** — `query-perf-row` list of non-200/slow/timed-out queries. Each row: status Pill (504/502/400 → `--destructive-soft/-ink`; slow-200 → `--warning-soft/-ink`), latency (red if >SLOW_MS), preagg-hit vs Trino-fallthrough badge, query-shape as member-name chips (cubes·measures·dimensions). Right-aligned action affordance (wired in P5: "Optimize →"; renders disabled/"Soon" until P5).
3. **Successful queries section (separate, default CLOSED)** — collapsible header ("Successful queries (N)") using the expandable-row pattern (preagg-runs-tab.tsx:642-654 / sweep-row). Closed by default; on expand, lazily fetch `/recent` and render the same `query-perf-row` (minus the optimize action; success rows can still show preagg-hit so admins see what's *correctly* rolling up).

### Design conformance (mandatory)
- Page header: eyebrow "Administration" + icon (e.g. `Gauge`/`Timer` from lucide) + 20/700 title "Query Performance", per design-guidelines §3 and the AdminHub header (index.tsx:71-90).
- Tokens only — status colors via `--*-soft/--*-ink`; no inline hex. Spacing from the scale. Reuse Pill/KPI/expandable components rather than forking.
- Dark-mode safe (semantic tokens). Run the §10 visual gate if baselines exist for /admin routes (add baseline if the route is captured in `routes.manifest.ts`).

## Related files
- Create: `server/src/routes/query-perf.ts`, `server/src/routes/query-perf.test.ts`, `query-perf-tab.tsx`, `query-perf-data.ts`, `query-perf-row.tsx`.
- Modify: `server/src/index.ts` (import+register), `src/pages/Admin/hub/index.tsx` (tab + route), maybe `tests/visual/routes.manifest.ts`.

## Todo
- [ ] **huashu UI gate**: HTML variants → AskUserQuestion pick/mix → save to `visuals/` (before any React)
- [ ] query-perf.ts routes (failures/recent/summary) admin-gated
- [ ] register in index.ts
- [ ] query-perf-data.ts hooks (poll + lazy recent)
- [ ] query-perf-tab.tsx (KPI strip + failures section + collapsed success section)
- [ ] query-perf-row.tsx (pill/latency/hit-badge/shape chips/action slot)
- [ ] tab + route in AdminHub
- [ ] route test (auth gate 403 non-admin; shape of failures/summary)

## Success criteria
- Non-admin → 403 on all `/api/query-perf/*` (test).
- A captured 504 appears in Failures section with red pill + latency; a 200 appears only under the (closed-by-default) success section after expand.
- KPIs match raw row counts for a seeded window.
- Visual: matches preagg-runs tab typography/spacing/tokens (cross-check adjacent page).

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Success list huge → slow render | M×M | Default-closed + lazy fetch + server `limit` cap (1000) + window `since`. |
| Percentile in SQLite awkward | M×L | Approximate p95 via `ORDER BY latency LIMIT/OFFSET` count math, or compute in JS over capped window. KISS — exact percentile not required. |
| preagg_hit NULL pre-P3 confuses UI | L×L | Render "unknown" badge until P3; documented. |

## Security
All read routes admin-gated (requireRole+requireFeature). UI behind `AdminHubRoute` (index.tsx:132-136). No query values exposed — rows carry NAMES only (enforced upstream in P1).

## Open questions
None blocking. (Whether to add /admin/query-perf to the visual-regression manifest — defer to UI implementer.)
