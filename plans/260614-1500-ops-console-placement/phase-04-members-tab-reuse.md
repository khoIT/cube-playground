---
phase: 4
title: "Members tab — uid search + link"
status: completed
priority: P2
effort: "0.25d"
dependencies: [1]
---

# Phase 4: Members tab — uid search + link (NOT embed)

## Overview
Red-team B1: `Member360View` is **propless and route-coupled** — it reads `useParams()` + `?game=` and
derives gameId from a fetched segment; it accepts no gameId/uid props. Embedding it would require lifting
its orchestration into a shared hook (~+0.5d + coupling). User decision (2026-06-14): **Members = link,
not embed.** So the Members tab is a uid search box that navigates to the already-routable member360.

## Requirements
- Functional: a uid input + "Open member 360" → navigates to `/dashboards/cs/members/:uid?game=<gameId>`
  (the existing standalone member360 route). Handles vopenid uids containing `@` (encode the route param).
  Empty/help state before input. Optionally recent-uid shortcuts.
- Non-functional: zero new member360 logic; no fork; no embed.

## Architecture
`members-tab.tsx`: controlled uid input + a `useHistory().push()` (HashRouter) to
`/dashboards/cs/members/${encodeURIComponent(uid)}?game=${gameId}`. gameId from `useGameContext()`.
Confirm the target route exists (`src/index.tsx` CS routes; scout cited `/dashboards/cs/members/:uid`).
A "Open in Members" deep-link button only — the heavy 360 view stays on its own route.

## Related Code Files
- Create: `src/pages/OpsConsole/members-tab.tsx`.
- Reference: `src/index.tsx` (confirm `/dashboards/cs/members/:uid` route + `?game=` handling),
  `src/pages/Segments/member360/member-360-view.tsx:40-66` (why it can't be embedded — propless/route).

## Implementation Steps
1. Confirm the member360 standalone route path + that it reads `?game=` (member-360-view.tsx:51-54).
2. `members-tab.tsx`: uid input + navigate-on-submit with encoded uid + `?game=`.
3. Verify a known cfm uid (incl. a vopenid `@` uid) lands on the working member360 page.

## Success Criteria
- [ ] uid search navigates to the existing member360 route for cfm/jus with correct `?game=`.
- [ ] vopenid (`@`) uids encode/resolve.
- [ ] No member360 code duplicated or forked; no embed.
- [ ] No new tsc/lint/build errors.

## Risk Assessment
- If product later wants the 360 IN-PAGE, that is a separate effort: extract `useMember360Profile(gameId,
  uid)` (incl. `useCubeApiBootstrap`, red-team L8) from member-360-view.tsx:85-118 and render
  `CsMember360View` from it. Out of scope for v1 (user chose link).
