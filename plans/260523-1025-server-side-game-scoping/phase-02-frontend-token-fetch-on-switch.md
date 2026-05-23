# Phase 2 — Frontend: fetch per-game token on switch

## Overview

- **Priority:** P0
- **Status:** pending

## Requirements

- On every `setGameId(newId)`, fetch the per-game token from
  `/api/playground/cube-token?game=<id>` and push it into
  `SecurityContextContext.saveToken(token)`.
- Bootstrap: at app load, after GameContext resolves the initial gameId,
  fetch the token for that game (overrides VITE_CUBE_TOKEN / cached token).
- `useCubejsApi` already memoizes on `(apiUrl, token)` — token change is enough
  to rebuild the client. `useCatalogMeta` already reacts to `gameId`. Playground
  remount happens via `key={gameId}` from prior PR.

## Architecture

```
src/
  api/
    cube-token-client.ts            # NEW: fetch + parse, swallow network errors
  components/Header/
    use-game-context.ts             # EXTEND: subscribe to gameId, push token
  hooks/
    use-cube-token-bootstrap.ts     # NEW: orchestrates fetch → saveToken
```

## Implementation steps

1. **`cube-token-client.ts`**:
   ```ts
   export interface CubeTokenResponse { token: string | null; source: string; }
   export const cubeTokenClient = {
     async get(gameId: string): Promise<CubeTokenResponse | null> { ... }
   }
   ```
   - 404 returns `null`, 500/network returns `null` (log warn).
2. **`use-cube-token-bootstrap.ts`**:
   - Consumes `useActiveGameId()` and `useSecurityContext()`.
   - Effect: when `gameId` changes (and is non-empty), fetch token and call
     `saveToken(token)`. Skip if response is null OR equals current token.
   - Mounted once near the top of the tree.
3. **Mount** in `App.tsx` (inside SecurityContextProvider scope) via a tiny
   sibling component (similar to existing `ContextSetter`).
4. **Init order**: GameContext resolves async via `gamesClient.list()`. Use the
   existing `ready` flag — the bootstrap hook waits for `ready === true`.
5. **Don't loop**: bootstrap stores last-applied `gameId` in a ref; only fetches
   when it differs.

## Related code files

**Create**
- `src/api/cube-token-client.ts`
- `src/hooks/use-cube-token-bootstrap.ts`

**Modify**
- `src/App.tsx` (mount the bootstrap component)
- `src/components/Header/use-game-context.ts` (no API change; verify `ready` flag is exported — it is)

## Todo

- [ ] cube-token-client
- [ ] use-cube-token-bootstrap hook
- [ ] mount in App
- [ ] manual test: switch game, watch network panel, /meta refetches with new Authorization
- [ ] typecheck + vitest

## Success criteria

- DevTools network: on game switch, `GET /api/playground/cube-token?game=<id>` fires once.
- Following `/cubejs-api/v1/meta` request carries the new JWT.
- Catalog metric count visibly differs across games.
- Playground tab clears + auto re-runs.

## Risks

- **Race**: rapid game switches could leave a stale token applied. Mitigation: use AbortController inside the hook, or last-write-wins by tagging each fetch with the gameId it was issued for and ignoring stale resolutions.
- **No backend secret in dev**: cube-token returns `{ token: null, source: 'none' }`. Frontend must not clobber the existing token with null. Guard: skip `saveToken(null)` unless explicitly requested.

## Security

- Token returned by `/api/playground/cube-token` is short-lived / dev-grade. Persisted to localStorage by `SecurityContextProvider` — same scope as the existing token. Acceptable.
