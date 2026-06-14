# Phase 5 — Route wiring + Care-tab drill link + docs sync

**Context links:** `src/pages/Segments/segments-page.tsx` (route table l.22-34; Member360 at l.31), `care-watchlist.tsx` (drill link), `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/lessons-learned.md`.
**Blocked by:** Phase 2 + Phase 4.

## Overview
- **Priority:** P2
- **Status:** pending (blocked)
- Register the new page route, confirm the Care-tab drill link resolves, verify the Members-tab → `Member360View` path is untouched, and sync docs.

## Data flow
```
/segments/:id           -> DetailView (Care tab -> watchlist row name -> /care)   [Phase 2 link]
/segments/:id/members/:uid       -> Member360View   (UNCHANGED — Members-tab drill)
/segments/:id/members/:uid/care  -> CareHistory360Page   (NEW — Care-tab drill)
```
Route order matters (react-router v5 `exact`): `/care` route must sit alongside the existing `/members/:uid` `exact` route (l.31). Add the more-specific `/care` route — both are `exact`, so order between them is safe, but both MUST precede the catch-all `/segments/:id` (l.32).

## Requirements
**Functional**
1. Add `<Route exact path="/segments/:id/members/:uid/care" component={CareHistory360Page} />` in `segments-page.tsx`, BEFORE the catch-all `/segments/:id` (l.32) and adjacent to the existing `/members/:uid` (l.31).
2. Verify the Care-tab watchlist name + "View full" links (Phase 2) resolve to this route.
3. Verify the Members-tab name-click still routes to `Member360View` (untouched) — grep for the Members-tab member link and confirm it targets `/members/:uid` (no `/care`). cfm/ballistar/jus/cros/tf segment dashboards must render unchanged.
4. Docs sync: note the new endpoint + page in `docs/codebase-summary.md` + `docs/system-architecture.md`; add a `docs/lessons-learned.md` entry IF a non-trivial gotcha surfaced (ms-timestamp, is_customer reliability, HTML sanitize).

**Non-functional**: no change to `Member360View` or the existing `/members/:uid` route.

## Related code files
**Modify**
- `src/pages/Segments/segments-page.tsx` — import `CareHistory360Page` + add one `<Route>`.
- `docs/codebase-summary.md`, `docs/system-architecture.md` — describe endpoint + page.
- `docs/lessons-learned.md` — conditional entry.

**Note:** `index.ts` is owned by Phase 1 (route registration) — Phase 5 does NOT touch it (no file-ownership overlap).

## Implementation steps
1. Add the route (lazy or direct import, matching how `Member360View` is imported l.14).
2. Manually click-through dev: Care tab → expand row → "View full" → page loads; back link → `/segments/:id?tab=care`.
3. Grep the Members-tab member-link component; confirm unchanged target `/members/:uid` (NOT `/care`).
4. Smoke other game dashboards (cfm/ballistar/cros/tf) for unchanged segment detail.
5. Update docs; add lessons-learned entry if warranted.

## Todo
- [ ] add /care route in segments-page.tsx
- [ ] verify Care-tab links resolve; back link correct
- [ ] verify Members-tab → Member360View untouched (grep + click)
- [ ] smoke cfm/ballistar/cros/tf segment detail unchanged
- [ ] docs/codebase-summary.md + system-architecture.md updated
- [ ] docs/lessons-learned.md entry (if gotcha)
- [ ] tsc + full vitest green

## Success criteria
- `/segments/:id/members/:uid/care` renders the page; Care-tab drill reaches it; Members-tab still reaches `Member360View`.
- No regression in existing segment dashboards; docs reflect the new surface.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| New route shadows `/members/:uid` | L×H | both `exact`; `/care` more specific; both before catch-all l.32 — verify by click-through |
| Members-tab accidentally repointed to `/care` | L×H | LOCKED: Members-tab stays on Member360View; grep+verify it's a different link than the Care watchlist row |
| Docs drift | L×L | update summary + architecture in this phase |

## Security
- No new public surface; route renders the `guardSegment`-gated page. Confirm the page errors cleanly (no PII leak) on 403/404.

## Open Questions — ALL RESOLVED (2026-06-13, user)
1. **uid membership assertion:** RESOLVED — **assert** `uid ∈ parseUids(uid_list_json)` → 404 `NOT_IN_SEGMENT` (Phase 1, step 2b, test h).
2. **Security label vocabulary:** RESOLVED — `securityFlag` hard signal = `login_info ≠ uid`; the `Account_*`/security label is a secondary AND-narrowing kept in ONE constant/regex in `cs-ticket-detail-signals.ts` so the vocab is maintainable in one place.
3. **HTML sanitizer:** RESOLVED — no sanitizer dep exists (`dangerouslySetInnerHTML` used in only one error component). v1 = **strip-to-plain-text** (server snippet + client render). No new dependency, zero XSS surface. Do NOT use `dangerouslySetInnerHTML`.
4. **Header recharge:** RESOLVED — `cs-recharge-trajectory` exposes per-uid pre/post **window sums**, not a daily series. v1 header shows the **pre→post delta stat** (reuse `summarizeCohortRecharge` on a 1-member cohort); full daily sparkline DEFERRED (would need a new reader).
