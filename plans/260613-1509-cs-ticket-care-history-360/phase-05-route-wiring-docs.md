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

## Open Questions
1. **uid membership assertion (Phase 1):** Should the endpoint additionally require `uid ∈ segment.uid_list_json`, or is `guardSegment(read)` on the segment sufficient? Default plan = assert membership (safer; a reader of segment X cannot pull arbitrary uids' transcripts). Confirm.
2. **Sentiment/security label vocabulary:** `securityFlag` keys on `Account_*` / "security" AI labels — is the exact `label_category`/`label_name` set stable across jus_vn/cfm, or do we need a configurable matcher (like `HIGH_STAKES_CATEGORY` regex in assembly)? Phase 0 uses a regex; confirm coverage.
3. **HTML sanitizer dependency:** Is there an existing sanitizer (DOMPurify) in `package.json`, or do we add one / use strip-to-text? (Resolved during Phase 4 step 1, but flag if a dep add needs approval.)
4. **Recharge sparkline on the header:** reuse `cs-recharge-trajectory` per-member series — confirm it exposes a single-uid daily series (current use is cohort-anchored). If not, the header spark may need a small reader addition or be dropped from v1.
