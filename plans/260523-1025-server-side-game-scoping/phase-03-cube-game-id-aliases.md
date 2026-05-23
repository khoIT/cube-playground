# Phase 3 — Cube backend: GAME_ALIASES map

## Overview

- **Priority:** P0 (without this, `cfm_vn`/`jus_vn` JWTs are rejected)
- **Status:** pending
- **Repo:** `cube-dev` (separate from cube-playground)

## Problem

`gds.config.json` (cube-playground) lists game IDs `ptg, ballistar, cfm_vn, jus_vn`.
`cube-dev/cube/cube.js` `SUPPORTED_GAMES` lists `ballistar, cfm, ptg, jus, muaw, pubg`.
- `cfm_vn` and `jus_vn` fail Cube's `SUPPORTED_GAMES.includes(payload.game)` check.

## Solution

Add a one-line alias map to `cube.js` so frontend-side IDs map to canonical
Cube IDs at the entry of every per-tenant hook.

```js
const GAME_ALIASES = {
  cfm_vn: 'cfm',
  jus_vn: 'jus',
};

function canonicalGame(game) {
  return (game && GAME_ALIASES[game]) || game;
}
```

Apply at three sites:
- `checkAuth`: normalize `payload.game` BEFORE the `SUPPORTED_GAMES.includes` check.
- `gameFor()`: normalize the resolved value before returning.
- `scheduledRefreshContexts`: continue to use canonical IDs from `SUPPORTED_GAMES` (no change).

## Implementation steps

1. Edit `/Users/lap16299/Documents/code/cube-dev/cube/cube.js`:
   - Add `GAME_ALIASES` const + `canonicalGame()` near the existing `GAME_SCHEMA`.
   - In `checkAuth`: `const game = canonicalGame(payload.game);` then validate.
   - In `gameFor`: wrap the result with `canonicalGame()`.
2. Restart Cube container (`docker compose restart cube` per `cube-dev/docker-compose.yml`).
3. Smoke: mint a JWT with `{ game: 'cfm_vn' }`, hit `/cubejs-api/v1/meta`, expect cfm yaml.

## Related code files

**Modify (external repo)**
- `/Users/lap16299/Documents/code/cube-dev/cube/cube.js`

**Read for context**
- `/Users/lap16299/Documents/code/cube-dev/docker-compose.yml`
- `/Users/lap16299/Documents/code/cube-dev/cube/auth-db.js`

## Todo

- [ ] Add `GAME_ALIASES` + `canonicalGame()`
- [ ] Wire into `checkAuth` and `gameFor`
- [ ] Restart Cube
- [ ] Smoke: cfm_vn JWT → cfm yaml

## Success criteria

- `jwt.verify` succeeds for both `game: 'cfm'` and `game: 'cfm_vn'`.
- `repositoryFactory` reads from `model/cubes/cfm/` for both.

## Risks

- Breaks any external script that pre-mints `game: 'cfm_vn'` and expects rejection. Unlikely — alias is permissive.
- Production Cube already strict on `SUPPORTED_GAMES`. This change widens acceptance. Acceptable.

## Security

- No security regression; alias mapping happens after JWT verification.
- Aliases never bypass `getUserAccess` — `access.allowedGames` is checked against the **canonical** game (post-alias) so RBAC stays consistent.
