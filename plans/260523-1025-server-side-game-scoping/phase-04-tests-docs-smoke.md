# Phase 4 — Tests, docs, smoke

## Overview

- **Priority:** P1
- **Status:** pending

## Test coverage

| File | Why |
|---|---|
| `server/test/sign-cube-token.test.ts` (new) | Known-vector HS256 parity |
| `server/test/resolve-cube-token.test.ts` (extend) | Env > mint > none order |
| `server/test/cube-token-route.test.ts` (new) | Happy / 404 / no-secret |
| `src/api/__tests__/cube-token-client.test.ts` (new) | Network failure → null |
| `src/hooks/__tests__/use-cube-token-bootstrap.test.tsx` (new) | Fetch + saveToken on game change |

## Manual smoke

- [ ] `CUBEJS_API_SECRET=<shared-secret> npm run --prefix server dev` + `npm run dev`
- [ ] Open app, switch GamePicker to Ballistar → Cube /meta returns ballistar cubes
- [ ] Switch to PTG → /meta returns ptg cubes (different from ballistar)
- [ ] Switch to CFM (cfm_vn) → /meta returns cfm cubes (relies on Phase 3 alias)
- [ ] Catalog tab: cube count differs across games
- [ ] Playground tab: open `/build`, select a measure, switch game → tab clears + re-runs

## Docs to update

- `docs/codebase-summary.md` — note the `/api/playground/cube-token` endpoint and the per-game token cycle.
- `docs/project-changelog.md` — entry for server-side game scoping.

## Todo

- [ ] All vitest suites green (frontend + server)
- [ ] Manual smoke checklist pass
- [ ] Docs updated
- [ ] `/ck:journal` entry
