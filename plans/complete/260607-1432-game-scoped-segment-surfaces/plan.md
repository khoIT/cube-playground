---
title: Game-scope all segment list surfaces
status: completed
priority: P1
effort: small
branch: main
tags: [segments, game-context, sidebar, bugfix]
created: 2026-06-07
---

# Game-scope all segment list surfaces

User report: switching game doesn't filter segments. Verified: library main list
DOES filter (`library-view.tsx:45` → server `AND game_id = ?`); the bleed is in
three secondary surfaces that fetch `list({ owner: '*' })` unscoped.

## Pinned decisions (user, 2026-06-07)
- Scope: ALL 3 surfaces (sidebar, concept-map, push-modal).
- Recents of other games: hidden, restored on switch-back (storage untouched).

## Changes
| Surface | File | Fix |
|---|---|---|
| Sidebar recents + shared pills | `src/shell/sidebar/sidebar.tsx` | pre-filter `segmentRows` by `useActiveGameId()` before building id set / shared selectors (client-side — keeps single-flight cache, instant on switch) |
| Catalog concept-map | `src/pages/Catalog/concept-map/use-concept-graph.ts` | filter segment rows by active game in the nodes memo (+ dep) |
| Push modal static picker | `src/pages/Segments/push-modal/push-modal.tsx:132` | add `game_id: gameId` to the list call (+ effect dep) |

Out of scope: library view (already correct), segment create paths (already
stamp game_id), detail-view deep links (by id, cross-game view intentional).

## Todo
- [x] Sidebar: game-scoped segmentIds / sharedSegments / sharedSegmentIds
- [x] Concept-map: game-filtered segment nodes
- [x] Push modal: game_id on static list fetch
- [x] Unit test: game scoping of sidebar selectors
- [x] tsc + vitest green (no NEW errors; member360 files mid-edit by sibling plan 260607-1419 — do not touch)

## Risk
- Sibling session actively editing member360 files — keep file sets disjoint.
- `segmentIds === null` pass-through while loading must survive (no flash-out).
