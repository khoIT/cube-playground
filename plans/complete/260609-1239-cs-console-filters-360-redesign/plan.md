---
title: "CS Console: route-bug fix, By-Playbook/By-VIP filters, Matched-Playbook column, care-first 360"
description: "Fix the /dashboards/cs double-render error; add multi-select playbook + status filters and uid/name search to the Case Ledger; rename the snapshot column to a Matched-Playbook pill + matched-time; rebuild the CS Member-360 as a care-history-first layout."
status: complete
priority: P2
branch: main
created: 2026-06-09
tags: [care, vip, cs, routing, filters, member360, ui]
---

# CS Console — Filters, Matched-Playbook column, Care-first 360

Five tasks from the user, scoped against the live code. Locked decisions (user, 2026-06-09):
1. **360 redesign = CS-only** (segment-less branch). Segments member-360 untouched.
2. **Care-history timeline = fully mocked** (treated outcomes don't exist in care_cases yet).
3. **Matched-Playbook pill links to** `/dashboards/cs/queue?playbook=<id>` (that playbook's queue).
4. **Status chips = all five** (new / in_review / treated / resolved / dismissed).
5. (Engineering) Backend uses **comma-list** `playbook`/`status` params + server **`q=`** search — scales to thousands, keeps server pagination correct.

## Verified anchors
- Route bug: `src/index.tsx:239-245` — sibling `<Route exact>`s, NO `<Switch>`. `/dashboards/:slug` (244) co-matches `/dashboards/cs` → `DashboardDetailPage` renders "Dashboard not found" (`dashboard-detail.tsx:121`) under `CsMonitorPage`.
- List route: `server/src/routes/care-cases.ts:75-98` (single `playbook`/`status`); store `listCases` `care-case-store.ts:124` single-value WHERE.
- by-vip: `care-cases.ts:100-147` — ranked then page-sliced; profiles enriched for slice only (search-by-name needs profiles for full ranked set when `q` present).
- `CareCase.opened_at` = match time; `profile.name` = display name (snapshot). `playbook_name` served on `/vip/:uid` only → add to list rows.
- Ledger UI: `src/pages/Dashboards/cs/case-ledger.tsx` (ByPlaybookView ~225, ByVipView ~415, WhyFiredCell 83). Hook `use-care-cases.ts`. Playbook picker source `use-care-playbooks.ts`.
- 360: `src/pages/Segments/member360/member-360-view.tsx` — SHARED; `segmentLess` branch (line 49) is the CS entry. Mounted via `index.tsx:87` as `CareMember360Page`.
- Filters handoff note: `plans/260608-2128-vip-care-cs-console-flow/by-playbook-filters-implementation-note.md` (outside-click via mousedown, NOT backdrop; URL as source of truth).

## Phases

| # | Phase | Status | Tasks | Files | Depends |
|---|-------|--------|-------|-------|---------|
| 1 | Route double-render fix | ✅ done | 1 | `src/index.tsx` (Switch wrap; `dashboard-detail.tsx` untouched) | — |
| 2 | Backend filters + search + playbook_name | ✅ done | 2,3,4 | `care-case-store.ts`, `routes/care-cases.ts` | — |
| 3 | By-Playbook UI: multi-select bar + status chips + Matched-Playbook pill + matched-time | ✅ done | 2,3 | `use-care-cases.ts`, `case-ledger.tsx`, new `playbook-filter-bar.tsx`, `status-chip-row.tsx` | 2 |
| 4 | By-VIP search (uid / name) | ✅ done | 4 | `use-care-cases.ts`, `case-ledger.tsx` | 2 |
| 5 | CS care-first Member-360 | ✅ done | 5 | new `src/pages/Dashboards/cs/member360/*`, branch in `member-360-view.tsx` | 1 |

**Delivered (260609):** All 5 phases shipped. Backend uses comma-list `playbook`/`status` + `IN (...)`; list rows now carry `playbook_name`/`playbook_priority` (additive); `by-vip` gained `q=` (uid OR name, full-set enrich when searching, priority order preserved). UI: prominent multi-select playbook bar (empty = all playbooks) + de-emphasized status chip row (page-scoped counts); "Matched Playbook" pill (links to that playbook's queue, snapshot in tooltip) replaced "Why it fired"; "Opened" → "Matched" (exact-time tooltip); debounced uid/name search on By-VIP. CS care-first 360 (segment-less branch only): live `DashboardHero` + central care timeline + recommended-action rail (clearly-labelled SAMPLE — treatment outcomes not persisted) + collapsed reference panels reusing Segments section components; "Mark treated" is a client-side visual stub, role-gated. Tests: 22 server route + 18 client hook/component added; full suite 1,175 green; server tsc 0, client tsc unchanged at 74 pre-existing (0 in touched files).

Phases 1 & 2 independent. 3 & 4 follow 2 (shared files → sequence). 5 large, independent of 2-4.

### Phase 1 — Route fix
Wrap the contiguous dashboards route family (`index.tsx:239-245`: cs-playbook-new, cs-playbook-edit, cs-queue, cs-member, cs, dashboards-detail `/dashboards/:slug`, dashboards list) in a `<Switch>` so only the first match renders. Ordering already correct (cs before :slug). Confirm `Switch` import. No other route group affected (catalog/segments are KeepAliveRoutes outside; drift-center+ stay outside). Verify `/dashboards/cs` shows only the monitor.

### Phase 2 — Backend
- `care-case-store.ts listCases`: accept `playbookId?: string|string[]`, `status?: CaseStatus|CaseStatus[]` → `IN (?,…)` clauses; single value stays back-compat.
- `GET /api/care/cases`: parse `playbook`/`status` as comma-lists; validate each status token; enrich each returned case with `playbook_name`+`playbook_priority` via `playbookMetaMap(game)`.
- `GET /api/care/cases/by-vip`: add `q` (trim, lowercase). When set, enrich profiles for the FULL ranked set, filter by `uid.includes(q) || profile.name.toLowerCase().includes(q)`, THEN paginate. When absent, keep current slice-then-enrich (no perf regression).
- Tests: extend `server/test/care-cases-route.test.ts` — comma playbook/status, `playbook_name` present, by-vip `q` matches uid and name.

### Phase 3 — By-Playbook UI
- `useCareCases(gameId, {playbookIds?: string[], statuses?: string[], page})` → comma params; keep `playbookId`/`status` singular accepted for callers. Returns rows already carrying `playbook_name`/`playbook_priority`.
- URL source of truth: `?playbook=01,04,14`, `?status=new,in_review`. Parse→string[]; togglePB guards length≥1.
- New `playbook-filter-bar.tsx`: bordered Playbooks bar — removable chips + searchable checkbox dropdown (mousedown outside-click close, multi-stays-open). Source `useCarePlaybooks`, exclude blocked/unavailable, group by NHÓM.
- New `status-chip-row.tsx`: de-emphasized row — All + 5 status chips with page-scoped counts (labelled "on page"), multi-select, Clear(n). Tints from `STATUS_STYLE`.
- Table changes (`ByPlaybookView`): replace "Why it fired" col → **"Matched Playbook"** = priority-tinted pill (`playbook_name`) linking to `/dashboards/cs/queue?playbook=<id>`; keep snapshot summary as the row/pill `title` tooltip (don't lose triage info). Rename "Opened" col → **"Matched"** (opened_at relative + exact tooltip). Row `key` = `playbook_id+'_'+id` (uids repeat across playbooks).
- Empty states per note. Tests: multi-playbook column appears; status filter narrows; pill href.

### Phase 4 — By-VIP search
- `useVipQueue(gameId, {q, page})` → pass `q`; reset page on q change (debounced ~250ms).
- `ByVipView`: search input (token-styled) above table; placeholder "Search uid or name". Empty state "No VIPs match \"{q}\".".

### Phase 5 — CS care-first 360
New layout rendered ONLY when `segmentLess` (Segments path keeps existing stacked dashboard). New dir `src/pages/Dashboards/cs/member360/`:
- `cs-member360-view.tsx` — orchestrator: hero card + tab bar (Profile / Activity / Recharge / Care history(N), Care history default) + content.
- `cs-care-hero.tsx` — id + tier/class/server/clan/last-active; right metrics LTV / LTV 30D / days-since-login / open-cases (from profile row where available, mock fallback).
- `cs-care-history-tab.tsx` — mocked vertical timeline (open NEW + treated outcomes w/ KPI/Responded chips) + **Recommended next action** rail (top open case, Call / Zalo ZNS buttons, bundle note, "Mark treated · log outcome").
- `cs-info-panels.tsx` — Profile/Activity/Recharge content as concise **expandable** panels reusing existing section components (monetization/profile/acquisition/journey) collapsed by default.
- `cs-member360-mock.ts` — the mock care timeline + recommended-action data (clearly labelled mock; cfm_vn flavour).
- All tokens only (Inter, semantic status pairs), mirror screenshot. Back-link → care queue. Keep `useCubeApiBootstrap` + uid decode from existing view.

## Cross-cutting
- `/api/care` reads viewer-ok (no new mutations this round — "Mark treated" rail button is a stub/links to existing PATCH flow only if trivially wired, else disabled placeholder).
- Tokens only; mirror CS Monitor header (24/32 padding, var(--font-sans)). No raw hex.
- Code comments / filenames: domain slugs only, no plan/finding refs.
- Files >200 LOC → split. Conventional commits, no AI refs. Commit only when user asks.

## Open questions (resolved)
- "Mark treated · log outcome" on the 360 rail → **visual stub** (resolved: user asked for a stunning visual stub). It optimistically prepends a sample "treated" event to the timeline client-side (clearly labelled, role-gated) and does not persist. A real PATCH lane is deferred to when treatment-outcome capture lands in `care_cases`.
