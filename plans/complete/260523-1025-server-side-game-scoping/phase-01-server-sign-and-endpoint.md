# Phase 1 — Server: HS256 signer + `/api/playground/cube-token`

## Overview

- **Priority:** P0 (blocks Phase 2)
- **Status:** pending

## Requirements

- Sign Cube-compatible JWTs with HS256 using `CUBEJS_API_SECRET`.
- Payload: `{ userId: 'playground', game, iat }`. Match Cube's `checkAuth`
  contract — `payload.game` must equal one of `SUPPORTED_GAMES`.
- Pre-minted `CUBE_TOKEN_<GAME>` env vars take precedence (ops override).
- `GET /api/playground/cube-token?game=<id>` returns
  - `200 { token: string | null, source: 'env' | 'minted' | 'none' }`
  - `404` if `game` unknown to `gds.config.json`.
- No new dependency: implement HS256 with `node:crypto` (~15 lines).

## Architecture

```
server/src/
  services/
    sign-cube-token.ts          # NEW: HS256 sign + base64url helpers
    resolve-cube-token.ts       # EXTEND: env → mint → null
  routes/
    cube-token.ts               # NEW: GET /api/playground/cube-token
  index.ts                      # register new route
```

## Implementation steps

1. **`sign-cube-token.ts`** — exports `signCubeToken(payload, secret)`:
   - `base64url(JSON.stringify(header))` + `'.'` + `base64url(JSON.stringify(payload))`.
   - HMAC-SHA256 of that string keyed by `secret`, base64url-encoded.
   - Concatenate. Return string.
   - Helpers: `base64UrlEncode(buf | string)`.
2. **`resolve-cube-token.ts`** — extend `resolveCubeTokenForGame(gameId)`:
   - If `CUBE_TOKEN_<GAME>` env set → return it (mark source 'env').
   - Else if `CUBEJS_API_SECRET` env set → sign + return (source 'minted').
   - Else fall back to `CUBE_TOKEN` env or `null` (source 'none').
   - Refactor signature to return `{ token: string | null, source: 'env' | 'minted' | 'fallback' | 'none' }` for the new route. Keep a thin compat wrapper returning the bare string for the existing anomaly-detector caller.
3. **`cube-token.ts`** — Fastify route. Validate `game` against `gds.config.json`'s game list (reuse loader from `routes/games.ts` — extract `loadConfig`). Return `{ token, source }` or 404.
4. **`server/src/index.ts`** — `app.register(cubeTokenRoutes)`.
5. **Tests**:
   - `sign-cube-token.test.ts` — known-vector parity (sign a fixed payload, verify with `node:crypto` HMAC).
   - `resolve-cube-token.test.ts` — extend: env wins, secret mints, neither → null.
   - `cube-token-route.test.ts` — happy path, unknown game 404, missing secret + no env → `source: 'none'`.

## Related code files

**Create**
- `server/src/services/sign-cube-token.ts`
- `server/src/routes/cube-token.ts`
- `server/test/sign-cube-token.test.ts`
- `server/test/cube-token-route.test.ts`

**Modify**
- `server/src/services/resolve-cube-token.ts`
- `server/src/routes/games.ts` (extract `loadGamesConfig` for reuse)
- `server/src/index.ts`
- `server/test/resolve-cube-token.test.ts`

## Todo

- [ ] `signCubeToken` + helpers
- [ ] Extend `resolveCubeTokenForGame` with mint fallback
- [ ] Extract `loadGamesConfig` from `routes/games.ts`
- [ ] `cube-token` route
- [ ] Tests (3 new files, 1 extended)
- [ ] `npm run --prefix server test` green

## Success criteria

- `curl /api/playground/cube-token?game=ptg` returns a JWT.
- `jwt.verify(token, CUBEJS_API_SECRET)` in Cube succeeds.
- Unknown game → 404.
- No new npm dependency added.

## Risks

- HS256 implementation drift. Mitigated by a known-vector test against a hand-built reference.
- `gds.config.json` IDs (`cfm_vn`) don't match Cube's `SUPPORTED_GAMES` (`cfm`). Phase 3 fixes Cube-side; meanwhile the server happily signs `game=cfm_vn` and Cube rejects in production. In dev mode Cube falls back, masking the issue. **Accept** for this phase — Phase 3 closes the loop.

## Security

- Secret never logged or echoed in response bodies.
- Returned token contains no secret material — base64-encoded HMAC signature only.
