# Brainstorm — Per-Member 360 Page (cfm v1)

Date: 2026-06-05 · Owner: khoitn · Status: design approved → ready for /ck:plan

## Problem
Segments members tab (`sample-users-tab.tsx`) lists member `uid`s as a paginated random sample, no drill-in. Need a per-member detail page modeled on the `cfm-user360` dashboard, reachable from a member row, showing one member's full 360 (profile, activity, recharge, roles, devices/IPs, monthly rollups, behavior event panels).

## Locked decisions (user-confirmed)
- **Surface:** full route page `/#/segments/:id/members/:uid` (deep-linkable). NOT modal/drawer.
- **Scope:** full 360 incl. all event-stream panels (26 cfm views).
- **Games:** cfm only in v1 (cros/tf/ballistar deferred — config-driven so trivial later).
- **Data source:** live Cube via cube-dev `/v1/load`. Independent of snapshot plan 260604-2319.
- **PII (device_id/client_ip):** show panels with a "PII" tag (no reveal-toggle, no omit).
- **Architecture:** config-driven panel registry + generic renderers (Approach A).

## Requirements
- Expected output: route + `Member360View` page rendering all 26 cfm `user_360.yml` views for one `user_id`, styled to design tokens; member rows in `sample-users-tab.tsx` clickable.
- Acceptance: click row → navigates; profile header + core panels paint ~0.5s; event panels load on "Behavior" expand with 31d-clamped date picker; playerid-bridge resolves for playerid-keyed panels; 2–3 values reconcile vs the cfm-user360 dashboard; back-nav → `?tab=members`; deep-link works.
- Out of scope: cros/tf/ballistar adaptivity, snapshot-API dependency, any write/edit, PII access-control beyond existing tool auth.
- Constraints: design-guidelines.md (Inter, `var(--*)` tokens, semantic soft·ink, page-header pattern); reuse cube-member-resolver helpers; honor `cube.js` 31d behavior guardrail.

## Evaluated approaches
| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| A. Panel registry + ~4 generic renderers | DRY; mirrors existing preset pattern; cros/tf-ready via config | renderers handle varied shapes | ✅ chosen |
| B. Hand-built per-panel components | pixel control | 26 bespoke panels; violates KISS/DRY | ✗ |
| C. Reuse Dashboards grid | tile reuse | grid = draggable, non-segment-scoped; physicalize lives in query hook not tiles | ✗ |

## Solution design
### Routing
- `segments-page.tsx`: add `<Route path="/segments/:id/members/:uid" component={Member360View} />`.
- `Member360View`: `segmentsClient.get(id)` → `game_id` + `identityDim`; render header + panels.
- `sample-users-tab.tsx`: uid cell → link to the route; back-nav restores members tab.

### Querying one member
- New sibling hook `useMemberCubeQuery(gameId, query, uid)` — reuses exported resolver helpers (`resolveGamePrefix` / physicalize / logicalize, `cube-member-resolver.ts`); adds only `user_id = uid`. Does NOT reuse `useSegmentCubeQuery` (it ANDs segment slice filters — wrong for full member history).
- Panel config (`member360-panels.ts`): per entry `{ title, view, members[], panelType, identityKey, needsDateRange }`.
- `panelType` renderers: `KpiStrip`, `DailyTimeline`, `DetailTable`, `EventStreamTable`.

### Event-panel identity bridge
- `user_login_panel` / `user_logout_panel`: join `clientsdkuserid = user_id` directly.
- playerid-keyed panels (matches, team_starts, money_flow, lottery, tutorial, newbie_detail, game_detail, prop_flow): resolve user's `role_id`s once via `user_roles_panel`, then filter `playerid IN (role_ids)`.

### Guardrail-aware behavior section
- Event panels in collapsible "Behavior" section; date-range picker default last 30d, hard-clamp ≤31d (satisfies `cube.js` BEHAVIOR_VIEWS guard).
- Eager: profile, roles, devices, ips, activity timeline, recharge timeline, monthly rollups. Lazy (on expand): the 11 event panels (money_flow alone 1.35B rows on Trino).

### Design
- huashu-design hi-fi HTML mockup first (cheap approval gate), then React to tokens: page-header (icon + uid title + `cfm` eyebrow), KPI strip, sectioned panels. PII panels tagged.

## Touchpoints
- Modify: `src/pages/Segments/segments-page.tsx` (route), `src/pages/Segments/detail/tabs/sample-users-tab.tsx` (clickable rows).
- Create: `src/pages/Segments/member360/Member360View.tsx`, `member360-panels.ts`, panel renderer components, `use-member-cube-query.ts`.
- Read/reuse: `src/lib/cube-member-resolver.ts`, `cube-dev/cube/model/views/cfm/user_360.yml`, `cube-dev/cube/cube.js` (guardrail contract).

## Risks
- Compile-passes-but-empty (silent join/key drift): reconcile 2–3 values vs dashboard, not just non-empty.
- Heavy event scans: mitigated by lazy-load + 31d clamp.
- playerid bridge: a user with 0 roles → playerid panels empty (expected; show empty-state, don't error).
- Cross-plan overlap with 260604-2319 (shares `detail/tabs/`): coordinate so a future pull-api-tab rewrite doesn't clobber the clickable-row change. No data dependency (live Cube).

## Success metrics
- Click→render works for a real cfm member; core panels < ~1s; event panels respect 31d; reconciles dashboard values; no regression to members tab / segment query path.

## Open questions
- None blocking. (PII access-control hardening, cros/tf adaptivity = explicit follow-ups.)
