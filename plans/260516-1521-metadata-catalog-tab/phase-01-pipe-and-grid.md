---
phase: 1
title: "Pipe and Grid"
status: pending
priority: P1
effort: "1-2d"
dependencies: []
---

# Phase 1: Pipe and Grid

## Context Links

- Brainstorm: [../reports/metadata-catalog-tab-system-meta.md](../reports/metadata-catalog-tab-system-meta.md)
- Existing fetch pattern: `src/hooks/cubejs-api.ts`
- Existing routes: `src/index.tsx`
- Existing nav: `src/components/Header/Header.tsx`, `src/components/Header/nav-pill.tsx`
- Vite proxy: `vite.config.ts`

## Overview

Wire env → JWT → fetch → bare card grid end-to-end. Validates the entire auth path against the Cube backend before investing in UX. No filters, no search, no drawer.

## Priority

P1 — gates all later phases. If JWT-sign-and-fetch fails, everything else is moot.

## Requirements

### Functional
- Read `VITE_CUBE_API_SECRET` from env at build time.
- Sign HS256 JWT browser-side **OR** (preferred) send raw secret as Bearer if Cube accepts.
- Fetch `/cubejs-system/v1/meta` via Vite dev proxy.
- New nav pill **Metadata** in header (third pill, after Models).
- New `/metadata` route renders a card-per-cube grid.
- Card shows: type icon, name, title, type badge, measure/dim counts.
- Loading + error states (basic).

### Non-functional
- Build succeeds with no env value set (tab renders empty-state, no crash).
- Single fetch on mount; in-memory cached.

## Key Insights

- `src/index.tsx` uses hash router (`createHashHistory`); route registration is a `<Route key="metadata" path="/metadata" component={MetadataPage} />` line.
- Existing fetch pattern goes through `@cubejs-client/core` SDK. System endpoint is not exposed by the SDK — must use `fetch()` directly.
- Vite proxy currently routes `/cubejs-api/*` and `/playground/*` to `:4000`. Add `/cubejs-system/*`.
- **Auth probe order:** try `Authorization: Bearer <SECRET>` first (no signing). If 401/403, add `jose` (~5KB tree-shaken) and sign HS256 JWT with `{ exp: now + 3600 }`. Document the chosen path in commit message.

## Architecture

```
.env.local                src/hooks/use-system-meta.ts
VITE_CUBE_API_SECRET ────> read env
                          │
                          ├─ build Authorization header (raw or signed)
                          │
                          └─ fetch('/cubejs-system/v1/meta')
                                │
                                └─> in-memory cache (module-scoped Map or useRef)
                                       │
                                       └─> hook returns { data, loading, error, refresh }

src/index.tsx             src/components/Header/Header.tsx
+ <Route path="/metadata">  + <NavPill to="/metadata" icon={Layers}>Metadata</NavPill>
       │
       ▼
src/pages/Metadata/MetadataPage.tsx
  └─ useSystemMeta()
  └─ <CatalogGrid cubes={data.cubes} />
        └─ <CubeCard /> × N
```

## Related Code Files

**Create:**
- `src/hooks/use-system-meta.ts` — fetch + auth + cache hook
- `src/pages/Metadata/MetadataPage.tsx` — route entry, layout shell
- `src/pages/Metadata/catalog-grid.tsx` — card grid layout (CSS grid)
- `src/pages/Metadata/cube-card.tsx` — single card component
- `src/pages/Metadata/index.ts` — barrel export
- `.env.example` (touch — add `VITE_CUBE_API_SECRET=`)

**Modify:**
- `src/components/Header/Header.tsx` — add third NavPill (`Layers` icon from `lucide-react`)
- `src/index.tsx` — register `/metadata` route
- `src/pages/index.tsx` — re-export `MetadataPage`
- `vite.config.ts` — add `'^/cubejs-system/.*': 'http://localhost:4000'` to `server.proxy`

**Conditional add (only if raw-bearer probe fails):**
- `package.json` — add `jose` dependency (HS256 sign only, tree-shakes well)

## Implementation Steps

1. **Probe auth path.** With Cube backend running, run `curl -H "Authorization: Bearer $CUBEJS_API_SECRET" http://localhost:4000/cubejs-system/v1/meta` and confirm 200. If 401, repeat with a JWT signed with the secret (`{ exp: now+3600, iat: now }`) — document which works.
2. **Wire Vite proxy.** Add `'^/cubejs-system/.*': 'http://localhost:4000'` to `vite.config.ts` proxy block.
3. **Add env var.** `.env.example` gets `VITE_CUBE_API_SECRET=` line. Document `.env.local` setup in README later (Phase 4).
4. **Create `src/hooks/use-system-meta.ts`:**
   - Read `import.meta.env.VITE_CUBE_API_SECRET`.
   - Sign or pass-through per step 1.
   - `fetch('/cubejs-system/v1/meta', { headers })`, parse JSON.
   - Module-scoped cache keyed by URL; return `{ data, loading, error, refresh }`.
   - If no secret, return `{ data: null, loading: false, error: 'missing-secret' }` — no fetch.
5. **Create page shell** `src/pages/Metadata/MetadataPage.tsx`:
   - Calls `useSystemMeta()`.
   - Three branches: missing-secret empty state (placeholder text), loading (`<CubeLoader />`), error (`<Alert />`), loaded → `<CatalogGrid />`.
6. **Create `catalog-grid.tsx`:** CSS grid `repeat(auto-fill, minmax(280px, 1fr))`, gap 16, padding 24.
7. **Create `cube-card.tsx`:** styled-components card. Renders type icon, name/title, type badge, measure/dim counts. No interaction yet (drawer is P3).
8. **Register route** in `src/index.tsx` (mirror `/schema` pattern, no `SecurityContextProvider` wrap — this page has its own auth).
9. **Add NavPill** in `src/components/Header/Header.tsx` (desktop pill row + mobile dropdown menu item).
10. **Smoke test:** `npm run dev`, navigate to `/#/metadata`, confirm cards render for every cube/view in the Cube backend.

## Todo List

- [ ] Probe auth path (curl test, document raw-vs-JWT)
- [ ] Add Vite proxy entry for `/cubejs-system/*`
- [ ] Add `VITE_CUBE_API_SECRET=` to `.env.example`
- [ ] Implement `use-system-meta.ts` hook (env read + fetch + cache + error states)
- [ ] Create `MetadataPage.tsx` shell with three render branches
- [ ] Create `catalog-grid.tsx` (CSS grid layout)
- [ ] Create `cube-card.tsx` (basic card with name, type, counts)
- [ ] Register `/metadata` route in `src/index.tsx`
- [ ] Add NavPill to `Header.tsx` (desktop + mobile)
- [ ] Smoke test: cards render against running Cube backend

## Success Criteria

- [ ] With `VITE_CUBE_API_SECRET` set in `.env.local`, navigating to `/#/metadata` shows one card per cube/view in the Cube schema.
- [ ] Without the env var, the page renders an empty-state placeholder (no crash, no fetch).
- [ ] Network tab shows exactly one `GET /cubejs-system/v1/meta` per page load.
- [ ] No regressions: `/build` and `/schema` still work; existing tests pass.
- [ ] `npm run build` succeeds and `npm run typecheck` is clean.

## Risk Assessment

- **Auth probe surprises.** Risk: backend rejects both raw-bearer and unsigned JWT. Mitigation: try `jose`-signed JWT; if still failing, raise to user before adding more deps.
- **CORS surprises.** Risk: backend rejects same-origin proxied request because of cookie/auth specifics. Mitigation: proxy entry mirrors existing `/cubejs-api/*` which works; if it fails, log response headers for diagnosis.
- **Bundle bloat from `jose`.** Risk: dep adds weight even if unused. Mitigation: only add if probe forces it; tree-shake to HS256 only.

## Security Considerations

- `VITE_CUBE_API_SECRET` ends up in the JS bundle. Phase 4 adds the PROD guard. In P1, document this in commit message and `.env.example` comment.
- No data flowing outside of localhost in dev posture.

## Next Steps

Once P1 lands and cards render, Phase 2 layers search + facets on top of the same data.
