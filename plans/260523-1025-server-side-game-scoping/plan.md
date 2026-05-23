# Server-side game scoping: per-game Cube tokens + reactive UI

**Slug:** 260523-1025-server-side-game-scoping
**Status:** Completed 2026-05-23 (server 128/128 + frontend 688/688 tests green)

## Problem

`cube-dev/cube/cube.js` is multi-tenant. It picks the tenant from
`securityContext.game` (carried in the Cube JWT). When no token (or a tokenless
dev request) reaches Cube, `gameFor()` falls back to `CUBEJS_DEFAULT_GAME` or
the hard-coded literal **'ballistar'**. The playground frontend sends a single
static token for every game, so the GamePicker UI never actually swaps the
underlying yaml — every game silently loads ballistar's cubes/views.

Plus: `gds.config.json` uses `cfm_vn`/`jus_vn` while Cube's `GAME_SCHEMA`
keys on `cfm`/`jus`. Even if the JWT carried `game=cfm_vn`, Cube would reject
or fall back.

## Goals

1. On game switch, the frontend sends a **JWT whose `game` claim matches**.
2. Playground server **mints** the JWT on demand using `CUBEJS_API_SECRET`
   (shared with Cube). Pre-minted `CUBE_TOKEN_<GAME>` env vars override.
3. Cube backend accepts our existing `cfm_vn`/`jus_vn` IDs via an alias map.
4. UI cycle on switch: fetch token → SecurityContext.saveToken → Cube /meta
   refetches → Playground tabs remount → catalog/segments refetch.

## Decisions confirmed

| Topic | Choice |
|---|---|
| Token source | Mint JWT on the fly with `CUBEJS_API_SECRET`. Env `CUBE_TOKEN_<GAME>` overrides for ops convenience. |
| ID mismatch | Add `GAME_ALIASES` map in `cube-dev/cube/cube.js`. No data migration. |
| Endpoint | `GET /api/playground/cube-token?game=<id>` → `{ token }` (or 404 if game unknown). |
| Switch behavior | Full cycle: fetch + saveToken + meta refetch + playground reset. |

## Phases

| # | File | Status | Summary |
|---|---|---|---|
| 1 | [phase-01-server-sign-and-endpoint.md](./phase-01-server-sign-and-endpoint.md) | ✅ done | HS256 signer + `/api/playground/cube-token` route + tests |
| 2 | [phase-02-frontend-token-fetch-on-switch.md](./phase-02-frontend-token-fetch-on-switch.md) | ✅ done | Wire GameContext → fetch token → SecurityContext.saveToken |
| 3 | [phase-03-cube-game-id-aliases.md](./phase-03-cube-game-id-aliases.md) | ✅ done | Add `GAME_ALIASES` to `cube-dev/cube/cube.js` |
| 4 | [phase-04-tests-docs-smoke.md](./phase-04-tests-docs-smoke.md) | ✅ done | Full test sweep, changelog, smoke verification |

## Key dependencies

- Phase 2 depends on Phase 1 (endpoint must exist).
- Phase 3 is independent (cube-dev repo).
- Phase 4 runs last.

## Out of scope

- Auth DB integration / user-scoped allowedGames (Cube's `getUserAccess` stub).
- JWT rotation / expiry policy beyond a long-lived dev token.
- Token refresh on 401 (initial mint is fire-and-forget).
- Backfilling existing segments whose `game_id` is `cfm_vn`/`jus_vn` to `cfm`/`jus` — alias map makes them functionally equivalent.

## Security notes

- `CUBEJS_API_SECRET` lives in the playground **server** env only. Never shipped to the browser.
- Minted JWT carries `userId: 'playground'` (anonymous, no RLS bypass) and the active `game`.
- Default expiry: none (long-lived dev token). Production should set `expiresIn`.
