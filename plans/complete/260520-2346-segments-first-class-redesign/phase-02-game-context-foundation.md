---
phase: 2
title: "Game-Context foundation"
status: completed
priority: P1
effort: "2d"
dependencies: []
brainstormId: P0a
---

# Phase 2 (P0a): Game-Context foundation

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §3.5 + §17
- Mockup: `../visuals/segments-first-class-mockup.html` — App shell screen shows GamePicker chip
- Existing Header: `src/components/Header/Header.tsx:88` (insert point between BrandBlock and PillRow)

## Overview

Introduce `game_id` as app-wide scope. Header gets a Game Picker chip; AppContext exposes `gameId`/`games[]`/`setGameId`; server reads `gds.config.json`; segments list endpoint accepts `?game_id=`; migration adds `game_id` column to `segments` table with backfill to `ptg`.

Parallel-safe with Phase 1 (no shared files). **Blocks Phases 3, 4, 5, 7, 8.**

## Key Insights

- Game picker is the visible signal that liveops works in one game at a time. Without it, the redesign's "first class" framing falls apart.
- Static config file is the YAGNI choice. MM-01 has no `/games` endpoint today; deriving from cube-schema dirs requires a per-game schema namespacing convention not yet verified.
- 4 seed games already locked: `ptg` (default), `ballistar`, `cfm_vn`, `jus_vn`.
- Migration backfill is safe — current segments are single-tenant in practice (no game scoping in code today).
- URL param `?game=` makes deep links carry game context (critical for shared links across teams).

## Requirements

**Functional**
- `gds.config.json` enumerates games at repo root; server reads at startup.
- `GET /playground/games` returns the registry.
- AppContext exposes `{ gameId, games, setGameId(id) }`. Persists `gameId` to `localStorage` key `gds-cube:active-game`. Reads `?game=` URL param on hash-route change as override.
- Header `GamePicker` chip renders active game with mark + name + id, opens Player Hub `Dropdown` listing all games.
- Switching games: fires `window.dispatchEvent('game-change')` (or React context update), toasts `Now showing data for {gameName}`, invalidates segments list state.
- Migration `004-game-scoping.sql`: `ALTER TABLE segments ADD COLUMN game_id TEXT NOT NULL DEFAULT 'ptg';`. Backfill all NULL → `'ptg'`. Add index on `(game_id, owner)`.
- Server `GET /segments` accepts `?game_id=` filter; default = no filter (admin view) → in practice client always sends one.
- Existing segments client `list()` sends `game_id` from AppContext.

**Non-functional**
- No regression for users who never switch games (default = `ptg`).
- GamePicker height ≤ 28px to fit 44px Header without crowding.
- Per-file LOC ≤ 200. Modularize GamePicker into 2 files: `game-picker.tsx` (component) + `use-game-context.ts` (hook + storage glue).

## Architecture

```
src/components/AppContext.tsx
  └─ gameId state (+ games[] from /playground/games fetch on bootstrap)
       │
       ▼
src/components/Header/game-picker.tsx (NEW)
  └─ <button class="game-picker"> with mark + name + chevron
       │ click
       ▼
  Player Hub Dropdown (antd Dropdown styled DS-aware) → setGameId(id)
       │
       ▼
  localStorage 'gds-cube:active-game' + URL ?game= param + toast

server/src/index.ts (or wherever routes wire up)
  └─ GET /playground/games — reads /gds.config.json
src/api/segments-client.ts
  └─ list() appends ?game_id=<active> via AppContext
server/src/routes/segments.ts
  └─ GET /segments accepts ?game_id= filter
server/src/db/migrations/004-game-scoping.sql (NEW)
```

## Related Code Files

**Create**
- `/Users/lap16299/Documents/code/cube-playground/gds.config.json`
- `/Users/lap16299/Documents/code/cube-playground/src/components/Header/game-picker.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/components/Header/use-game-context.ts`
- `/Users/lap16299/Documents/code/cube-playground/server/src/routes/games.ts` (or extend an existing routes file if `/playground/*` already lives somewhere)
- `/Users/lap16299/Documents/code/cube-playground/server/src/db/migrations/004-game-scoping.sql`

**Modify**
- `/Users/lap16299/Documents/code/cube-playground/src/components/AppContext.tsx` (add gameId state + games fetch)
- `/Users/lap16299/Documents/code/cube-playground/src/components/Header/Header.tsx` (insert `<GamePicker />` between BrandBlock and Spacer)
- `/Users/lap16299/Documents/code/cube-playground/src/api/segments-client.ts` (append `?game_id=` to `list()`)
- `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts` (accept `?game_id=` filter in list endpoint)
- `/Users/lap16299/Documents/code/cube-playground/server/src/types/segment.ts` (add `game_id: string` field)
- `/Users/lap16299/Documents/code/cube-playground/src/types/segment-api.ts` (mirror frontend type)
- `/Users/lap16299/Documents/code/cube-playground/server/src/db/snapshot-store.ts` (include game_id in insert/select)
- `/Users/lap16299/Documents/code/cube-playground/src/i18n/*` (add keys: `header.gamePicker.label`, `header.gamePicker.switchToast`)

**Delete** — none.

## Implementation Steps

1. **Config** — Create `gds.config.json` at repo root with 4 seed games + `defaultGameId: ptg`.
2. **Server endpoint** — Create `games.ts` route → `GET /playground/games` reads + returns config.
3. **Migration** — Add `004-game-scoping.sql` per Architecture section. Run + verify backfill (`SELECT COUNT(*) FROM segments WHERE game_id IS NULL` = 0).
4. **Server list filter** — `server/src/routes/segments.ts` reads `req.query.game_id`, adds `WHERE game_id = ?` to list SQL when present.
5. **Snapshot store** — `snapshot-store.ts` insert/update includes `game_id`. Default falls back to active game from request context (or 'ptg' if absent in tests).
6. **Frontend type** — Mirror `game_id: string` in `src/types/segment-api.ts`.
7. **AppContext** — Add `gameId` state. On mount: fetch `/playground/games`. Read URL `?game=` → fallback to localStorage `gds-cube:active-game` → fallback to `defaultGameId` from config. Expose `setGameId(id)` that persists to localStorage + updates URL param + emits a context value change.
8. **Hook** — `use-game-context.ts` encapsulates storage + URL param glue. Avoid `AppContext.tsx` ballooning past 200 LOC.
9. **Component** — `game-picker.tsx` (~150 LOC) renders chip + antd `Dropdown` with menu items per game. Sentence-case labels. Lucide chevron-down icon.
10. **Header wiring** — Insert `<GamePicker />` in `Header.tsx` at line ~88 (between BrandBlock and Spacer).
11. **Segments client** — `list({...})` reads `gameId` from AppContext via a thin singleton getter (or pass through call-sites). Append `?game_id=<id>` to the request URL.
12. **i18n** — Add picker label + switch toast strings.
13. **Toast on switch** — Use existing antd `message` (already used elsewhere in segments).

## Todo List

- [x] `gds.config.json` at repo root with 4 games + defaultGameId
- [x] Server: `GET /api/playground/games` endpoint
- [x] Migration 004: add `game_id` column + backfill + index
- [x] Server: segments list accepts `?game_id=` filter
- [x] `snapshot-store.ts` includes `game_id` in insert (defaults to 'ptg' for legacy snapshots)
- [x] Frontend type: `Segment.game_id: string`
- [x] `GameContextProvider` (game state lives in its own React context, not bloated AppContext) — games fetch on bootstrap + URL/localStorage hydration
- [x] `use-game-context.ts` hook (provider + hooks)
- [x] `game-picker.tsx` component
- [x] Wire `<GamePicker />` into `Header.tsx`
- [x] `segments-client.list()` accepts `game_id` param; library-view passes active gameId
- [x] i18n keys for picker label + switch toast (en + vi)
- [ ] Manual QA: switch games → library re-fetches with new scope; refresh page → game persists (manual — pending)

## Success Criteria

- [ ] GamePicker visible in Header at 28px height, fits 44px Header.
- [ ] Switching games re-fetches segments and shows toast.
- [ ] `localStorage` key `gds-cube:active-game` persists across reload.
- [ ] `?game=ballistar` URL deep-links to that scope.
- [ ] `GET /segments?game_id=ptg` returns only ptg segments.
- [ ] All pre-existing segments backfilled to `ptg` (verify with SQL).
- [ ] No console errors; no regression on existing surfaces while picker stays on default.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Switching games mid-Cube-query causes stale result render | M | On `setGameId`, cancel in-flight queries; invalidate segments client cache; rely on React state reset (KeepAliveRoute remount on context change) |
| `Header.tsx` already at 147 LOC — adding picker imports may breach 200 | L | Picker is a single import line; component lives in its own file |
| URL `?game=` collides with antd Router or existing query params | L | Audit existing query-param consumers before merge (`grep -r "URLSearchParams"`); use prefixed key `gds_game` if conflict |
| Tests with hardcoded `owner: '*'` filter may break with mandatory `game_id` filter | M | Make `game_id` filter optional server-side; tests stay green; client always sends one in practice |
| `gds.config.json` accidentally committed with secrets later | L | Config is plain-text registry only; document "no secrets" in file header comment |

## Security Considerations

- `gds.config.json` is public (committed to repo). Document: no auth tokens / no secrets.
- `?game_id=` filter must be sanitized server-side (use parameterized SQLite query — already the pattern in `segments.ts`).
- Future JWT auth (out of scope) would override picker with token claim; design AppContext to accept an override channel without rewrite.

## Next Steps

Unblocks: Phase 3 (Library uses scoped list), Phase 4 (activations[] piggybacks on Segment record), Phase 5 (Detail respects scope), Phase 7 (Push modal derives `game_id` from context), Phase 8 (Catalog filters by game).
