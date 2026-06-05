# Phase 03 — Main-Server Proxy + FE Fetch Hook + Empty-Hero Integration

## Context Links
- Plan: [plan.md](plan.md)
- Depends on: [phase-02](phase-02-generation-route-staleness-llm-refine.md) (route contract live)
- Proxy file (CRITICAL): `server/src/routes/chat.ts` — explicit per-route handlers; `app.all('/api/chat/*')` at line 134 is ONLY the feature-disabled guard
- Turn proxy forwards game+workspace: `server/src/routes/chat.ts:186-195` (`X-Cube-Game: body.game`, `X-Cube-Workspace: request.workspace.id`)
- FE headers: `src/api/chat-auth-headers.ts` (`chatHeaders()` sends Authorization + X-Owner-Id + X-Cube-Workspace)
- FE active game: `src/components/Header/active-game-storage.ts` (`getActiveGameId`, `GAME_HEADER = 'x-cube-game'`)
- Existing starter consumer: `src/pages/Chat/components/chat-empty-hero.tsx:48-62` (`useStarterRanking(min, filter)`)
- Static fallback list: `src/pages/Chat/library/starter-questions.ts` (`STARTER_QUESTIONS`)
- Ranking hook: `src/pages/Chat/library/use-starter-ranking.ts` (ranks a pool through persona-histogram)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** Add the twin proxy handler on the main server (forwarding workspace + game), a FE fetch hook that loads the generated set with the static 18 as fallback, and wire it into the empty-hero so the grid uses the generated pool. Persona filter + histogram ranking stay unchanged (they operate on whatever pool they're handed).

## Key Insights
- **Lessons-learned "dead route":** a new chat-service route is dead until the main server proxies it. Must add an explicit `GET /api/chat/starter-questions` handler in `server/src/routes/chat.ts`. The shared `proxyJson` helper forwards owner+workspace but NOT game — this route needs game forwarded, so add a dedicated handler (read `request.workspace.id` + the active game).
- The FE empty state has NO session, so game does not come from a session row — it comes from `getActiveGameId()` (the same source `api-client` uses). But the FE chat clients use raw `fetch` + `chatHeaders()`, which sends workspace but NOT game. Two clean options:
  - (A) Add `x-cube-game` to the request in the new client using `getActiveGameId()` + `GAME_HEADER` (localized, no change to shared `chatHeaders`).
  - **Chosen: (A)** — keep `chatHeaders` untouched (it's shared by session routes that get game elsewhere); the new client appends the game header itself.
- The main-server proxy reads game from the **query param** `?game=`, not a body (GET). So the FE sends `?game=<activeGameId>` AND the `x-cube-game` header is set by the proxy from that param when forwarding upstream (chat-service route reads the header). Keep both consistent.
- Static fallback is the FE's job: when the hook gets `source:'static-fallback'` or an empty list or a fetch error, it returns `STARTER_QUESTIONS`. Zero regression by construction.

## Requirements
### Functional — proxy (`server/src/routes/chat.ts`)
- `GET /api/chat/starter-questions` handler:
  - Resolve owner (reuse `resolveOwner`); resolve game from `request.query.game` (400 if absent).
  - Forward to `${chatServiceUrl()}/api/chat/starter-questions` with headers `X-Owner-Id`, `X-Cube-Workspace: request.workspace.id`, `x-cube-game: <game>`.
  - Pipe JSON response + status back.

### Functional — FE hook (`src/pages/Chat/library/use-generated-starters.ts`)
```ts
useGeneratedStarters(): { starters: ReadonlyArray<StarterQuestion>; source: string; loading: boolean }
```
- On mount (and on game/workspace change), `fetch('/api/chat/starter-questions?game=' + activeGame, { headers: chatHeaders({...}), cache:'no-store' })`.
- Map response `questions` → `StarterQuestion[]`. If `questions.length === 0` OR `source==='static-fallback'` OR fetch fails → return `STARTER_QUESTIONS` (static) with `source:'static-fallback'`.
- Re-fetch when active game or workspace changes (listen to `GAME_CHANGE_EVENT` / workspace change, or key the effect on `getActiveGameId()`+`getActiveWorkspaceId()`).

### Functional — empty-hero wiring (`chat-empty-hero.tsx`)
- Replace the module-level `STARTER_QUESTIONS` pool feeding the ranking with the hook's `starters`.
- `useStarterRanking` already takes a pool implicitly via `STARTER_QUESTIONS` import — REFACTOR it to accept the pool as an argument so the hero passes the generated pool. (Keeps ranking logic untouched; only the source of the pool changes.)
- Cold-start / persona filter behavior unchanged; comment in hero referencing "16/18 starters" updated to be count-agnostic.

## Architecture — data flow
```
empty-hero mount
  → useGeneratedStarters() ── fetch /api/chat/starter-questions?game= ──▶ main-server proxy
       ▲ static fallback on empty/err                                       └▶ chat-service GET (phase-02)
  → pool = starters (generated | static)
  → useStarterRanking(min, filter, pool)  →  persona-histogram rank  →  StarterLibraryGrid
```

## Related Code Files
**Create:**
- `src/pages/Chat/library/use-generated-starters.ts`
**Modify:**
- `server/src/routes/chat.ts` — add `GET /api/chat/starter-questions` proxy handler.
- `src/pages/Chat/library/use-starter-ranking.ts` — accept `pool: StarterQuestion[]` argument (default `STARTER_QUESTIONS` for back-compat).
- `src/pages/Chat/components/chat-empty-hero.tsx` — consume `useGeneratedStarters`, pass pool to ranking.

## Implementation Steps
1. Add the proxy handler in `chat.ts` (model it on the existing focus GET handler at `:443`, but forward `x-cube-game` from `request.query.game`).
2. Write `use-generated-starters.ts` with static fallback + re-fetch on game/workspace change.
3. Refactor `use-starter-ranking.ts` signature to `(minSessions, filter, pool)`; default param keeps existing callers compiling.
4. Wire `chat-empty-hero.tsx` to pass `useGeneratedStarters().starters` as the pool.
5. Compile FE: `npm run build` (or `npx tsc --noEmit` at repo root).

## Todo List
- [ ] Proxy `GET /api/chat/starter-questions` forwards workspace + game (test through :3004, not just :3005)
- [ ] `use-generated-starters.ts` (fetch + static fallback + re-fetch on game/ws change)
- [ ] `use-starter-ranking.ts` accepts pool arg (default static)
- [ ] `chat-empty-hero.tsx` uses generated pool
- [ ] FE typecheck clean

## Success Criteria
- `curl :3004/api/chat/starter-questions?game=<g>` (chat enabled) returns the generated JSON; `curl :3005/...` direct returns the same — proves the proxy isn't dropping the route.
- With backend returning a generated set, the grid renders the generated questions; switching active game re-fetches and renders a different set.
- Backend down / returns `static-fallback` → grid renders the static 18 (no blank, no error).

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| New route dead behind proxy (catch-all is disable-guard only) | H×H | Add explicit proxy handler; success-criteria curls :3004 AND :3005 |
| `chatHeaders` doesn't send game → upstream meta empty | M×H | New client appends `x-cube-game` via `getActiveGameId()`; proxy forwards query `game` |
| Refactoring `use-starter-ranking` breaks other callers | L×M | Default param = `STARTER_QUESTIONS`; grep callers (only hero + overlay in phase-04) |
| Page flicker static→generated on load | L×L | Acceptable; static is a valid set. Optionally render static until first response |

## Security Considerations
- Owner resolution reused from `resolveOwner` (server-authoritative). Workspace from `request.workspace.id`. Game from query param — the upstream `/meta` fetch is gated by the gateway; no per-user data crosses this route.

## Next Steps
- Phase 4 reuses `useGeneratedStarters` for the sidebar overlay's 3 chips (top-3).
