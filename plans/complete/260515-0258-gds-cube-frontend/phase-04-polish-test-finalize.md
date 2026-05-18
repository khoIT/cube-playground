# Phase 04 — Polish, Test, Finalize

## Context Links

- Research: [`../reports/research-260515-0243-gds-cube-frontend.md`](../reports/research-260515-0243-gds-cube-frontend.md) §"Phase 4 — Polish"
- Reference (study only):
  - `cube/packages/cubejs-playground/src/App.tsx` `componentDidCatch` pattern
  - `cube/packages/cubejs-playground/src/events.ts` (telemetry — replace with stub)
- Blockers: [phase-02-playground-port.md](phase-02-playground-port.md), [phase-03-data-model-browser.md](phase-03-data-model-browser.md).

## Overview

- **Priority:** P1
- **Status:** completed
- **Effort:** 0.5d
- Close the loop: deep-link reception in Playground, route-level error boundaries, telemetry stub, vitest tests for the load-bearing logic, Settings page (token + recent-tab cleanup), build verification, README.

## Key Insights

- Deep links worth supporting now: `/playground?tab=<id>&query=<encoded>`. Reading happens in `playground-page`; if `query` present + no matching tab, create a new tab seeded with that JSON.
- Error boundaries should be **per-route** (not just root) so a crash in Data Model doesn't blank the whole shell.
- Telemetry: reference `events.ts` exports `event()` consumed throughout QBv2. Cheapest correct path = ship a no-op stub at the same import path; users can later wire to internal analytics.
- Tests scope must be load-bearing: `use-meta` parsing (view fallback, error path), `cube-context` (env precedence, validation), `build-seed-query` (pure fn). Don't test antd internals.
- Settings page must exist (route exists from phase-01) — give it real content: API URL display, token status, "Clear stored tabs" button.

## Requirements

**Functional**
- Visiting `/playground?query=<encoded JSON>` opens a fresh tab pre-seeded with that query (or focuses an existing tab if one matches `?tab=<id>`).
- Route-level `<error-boundary>` wraps each top-level page; a thrown error inside Data Model shows a contained fallback, not a blank app.
- Telemetry stub: `src/events.ts` exports `event(name: string, props?: Record<string, unknown>): void` — no-op + `console.debug` in dev only.
- `/settings` route renders: API URL (read-only), token status ("Set" / "Not set"), buttons: "Set token" (opens phase-01 modal), "Clear token", "Clear stored query tabs", build version (from `package.json`).
- `npm run test`: at least the three test files below pass.
- `npm run build`: clean dist; index.html + assets only; no source maps with secrets.
- `README.md` with: run instructions, env vars, prod hosting note (`try_files` for SPA).

**Non-functional**
- All files kebab-case, ≤200 LOC.
- Coverage target: aim ≥80% on `use-meta.ts`, `cube-context.tsx`, `build-seed-query.ts` — don't enforce repo-wide threshold.
- Bundle size: ad-hoc check post-build (no formal budget yet).

## Architecture

```
Deep-link parsing
─────────────────
  URL: /playground?tab=t-3&query=eyJ...
        │
        ▼
  playground-page  (useSearchParams)
        │
        ├─ if ?tab=<id>  → activateTab(id)
        ├─ if ?query=<j> → const q = safeParseJson(j)
        │                    if q → openOrFocusTab({ seed: q })
        └─ strip params from URL after consumption (history.replace)

Error boundary layering
───────────────────────
  <app-error-boundary>      ← phase-01 (root)
    └─ <Routes>
        ├─ /playground   wrapped by <route-error-boundary>
        ├─ /data-model   wrapped by <route-error-boundary>
        └─ /settings     wrapped by <route-error-boundary>

Test matrix
───────────
  use-meta.test.ts        — happy path | view fallback | error path
  cube-context.test.tsx   — env read | localStorage precedence | setToken
                            persists | validate() rejects bad token
  build-seed-query.test.ts — picks *.count | first measure | first
                             dimension | filters isVisible:false
```

## Related Code Files

**Create**
- `src/events.ts` — telemetry stub (no-op + dev `console.debug`).
- `src/components/error-boundary/route-error-boundary.tsx` — per-route wrapper.
- `src/pages/settings/settings-page.tsx` — content for `/settings`.
- `src/pages/settings/clear-tabs-button.tsx` — clears `gds-cube:query-tabs` from localStorage.
- `src/pages/playground/use-playground-deep-link.ts` — reads + consumes `?tab=`/`?query=` from `useSearchParams`.
- `src/test-setup.ts` — vitest jsdom setup (jest-dom matchers, ResizeObserver shim).
- `src/hooks/__tests__/use-meta.test.ts`
- `src/context/__tests__/cube-context.test.tsx`
- `src/pages/data-model/__tests__/build-seed-query.test.ts`
- `README.md` (top-level) — run / env / build / prod hosting notes.

**Modify**
- `src/routes.tsx` — wrap each route's element with `<route-error-boundary>`.
- `src/pages/playground/playground-page.tsx` — call `use-playground-deep-link` on mount.
- `src/pages/settings/_placeholder.tsx` (from phase-01) → replaced by real `settings-page.tsx`; remove placeholder.
- `package.json` — add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"build:check": "tsc --noEmit && vite build"`.

**Delete**
- `src/pages/_placeholder.tsx` (if still present from phase-01 once all routes have real pages).

## Implementation Steps

1. **Telemetry stub** (`src/events.ts`):
   ```
   export function event(name: string, props?: Record<string, unknown>): void {
     if (import.meta.env.DEV) console.debug('[evt]', name, props);
   }
   ```
   Confirm QBv2 imports resolve to this stub (phase-02 noted local stub — collapse into this single file).
2. **Per-route error boundary** (`route-error-boundary.tsx`):
   - Class component with `getDerivedStateFromError`.
   - Fallback UI: `"Something broke in this page"` + reload button + "Go to /playground" link.
3. **Wire boundaries in `routes.tsx`**: wrap each top-level element. Keep root `<error-boundary>` from phase-01 as outer safety net.
4. **Deep-link hook** (`use-playground-deep-link.ts`):
   - `const [params, setParams] = useSearchParams();`
   - On mount + on `params` change: read `tab`, `query`. If both empty → no-op.
   - Validate `query` via try/catch JSON parse + minimal shape check.
   - Apply via `queryTabs` reducer action (`OPEN_TAB_WITH_QUERY` or activate-existing).
   - After consumption: `setParams({}, { replace: true })` to clean URL.
5. **Settings page** (`settings-page.tsx`):
   - Read API URL via `getApiUrl()`.
   - Show token state via `useCubeAuth()`.
   - Buttons: "Set token" → opens phase-01 modal; "Clear token" → `setToken('')` + remove key; "Clear stored query tabs" → `localStorage.removeItem('gds-cube:query-tabs')` + reload.
   - Display app version from `package.json` (`import pkg from '../../package.json'`).
6. **Tests** — `src/test-setup.ts`:
   - Import `@testing-library/jest-dom`.
   - Polyfill `ResizeObserver`, `matchMedia` (antd needs them in jsdom).
7. **Test: `use-meta.test.ts`**:
   - Mock `cubeApi` with `meta: vi.fn()`.
   - Case 1: returns mixed cubes + views → assert partition correctness, `byName` keys.
   - Case 2: cubes without `type` field → all land under `cubes`, `views` empty.
   - Case 3: `meta()` rejects → state has `error`, `loading: false`.
8. **Test: `cube-context.test.tsx`**:
   - Render provider in jsdom.
   - Case 1: `VITE_CUBE_TOKEN=abc` + empty localStorage → context exposes `token: 'abc'`.
   - Case 2: localStorage has `gds-cube:token=xyz`, env is set → localStorage wins (`xyz`).
   - Case 3: `setToken('new')` → localStorage updated + memoised cubeApi changes identity.
   - Case 4: `validate()` with rejecting meta → `lastError` populated.
9. **Test: `build-seed-query.test.ts`** (pure fn — no React):
   - Picks `orders.count` if available + visible.
   - Skips `isVisible:false` measures.
   - Falls back to first dimension if no measures.
   - Returns `{}` for empty cube.
10. **README.md**:
    - Quickstart (`npm i`, `npm run dev`).
    - Env vars table (`VITE_CUBE_API_URL`, `VITE_CUBE_TOKEN`).
    - Auth flow: paste-JWT modal; localStorage key.
    - Production hosting: serve `dist/` behind nginx with `try_files $uri /index.html`; proxy `/cubejs-api` → Cube backend.
    - Note: `CUBEJS_DEV_MODE=true` allows empty token.
    - Telemetry: stubbed (`src/events.ts`); replace `event()` body to wire analytics.
11. **Final build verification**:
    - `npm run build:check` → tsc + vite build clean.
    - `npm run test` → all tests green.
    - Manual: dev server, hit all four routes, paste-JWT validates, build a query, open in playground from data-model, deep-link `?query=…` works.
    - Grep audit: `grep -rE "from .*(cloud|live-preview|vizard|rollup-designer|graphiql|@apollo|codesandbox)" src` → empty.

## Todo List

- [x] `src/events.ts` telemetry stub
- [x] `src/components/error-boundary/route-error-boundary.tsx`
- [x] `src/routes.tsx` wraps each route
- [x] `src/pages/playground/use-playground-deep-link.ts`
- [x] `src/pages/playground/playground-page.tsx` consumes deep link
- [x] `src/pages/settings/settings-page.tsx` + `clear-tabs-button.tsx`
- [x] `src/test-setup.ts` (jest-dom + jsdom shims)
- [x] `use-meta.test.ts` passes
- [x] `cube-context.test.tsx` passes
- [x] `build-seed-query.test.ts` passes
- [x] `README.md` written
- [x] `package.json` scripts updated
- [x] `npm run build:check` clean
- [x] Grep audit for forbidden imports clean
- [x] Manual end-to-end smoke through all four routes

## Success Criteria

- All vitest suites green.
- `npm run build` produces `dist/` with `index.html` + chunks; size logged for baseline.
- `tsc --noEmit` clean.
- Deep link round-trip: open Data Model → click "Open in Playground" → lands on `/playground` with a working pre-seeded tab → URL is cleaned (no lingering `?query=`).
- Manual error injection (`throw new Error()` in `cube-detail`) shows route-level fallback, not blank app, and other routes still navigable.
- `/settings` shows correct token status; "Clear stored query tabs" removes localStorage entry.
- README accurately documents env + prod hosting.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| Deep-link consumer races phase-02 tab reducer init | M | M | `use-playground-deep-link` waits for `tabsReady` flag from QueryTabs context before acting; else queue. | ✓ Implemented |
| Telemetry stub collides with phase-02's local stub (duplicate `events.ts`) | M | L | Phase-02 stub lives inside QBv2 dir; phase-04 stub at `src/events.ts`. Re-point QBv2 imports during this phase (`from '../../events'`). | ✓ Unified |
| antd modal triggers jsdom errors (`matchMedia` undefined) in tests | H | M | `test-setup.ts` polyfills `matchMedia`, `ResizeObserver`. | ✓ Resolved |
| Build pulls in unused antd locales/icons inflating bundle | M | L | Defer; record post-build size; tree-shake antd imports already on import side. | ✓ 946KB measured |
| Long `?query=` payload exceeds nginx default buffer when deep-linking | L | M | Default nginx 8KB request header is plenty for typical Cube queries. Document in README only. | ✓ Documented |
| Error boundaries hide real bugs in dev | L | M | In dev, log full stack via `console.error` inside `componentDidCatch`. | ✓ Implemented |

## Security Considerations

- Settings page exposes "Clear token" — useful for shared workstation hygiene. Document in README.
- README must NOT include any sample JWT or `CUBEJS_API_SECRET`.
- Deep-link `?query=` is parsed via `JSON.parse` only (no `eval`); reject if not a plain object (instanceof Object && not array).
- `clear-tabs-button` wipes potentially sensitive filter values stored in localStorage.
- Error-boundary fallback must NOT render `error.stack` to users (only dev `console.error`).

## Next Steps

- After phase-04: full app demoable end-to-end.
- Future work (out of scope, log as follow-ups):
  - Optional GraphQL tab (research §Unresolved Q4).
  - Dev-mode tab for `/playground/files` (research §1.13, §line 109).
  - Internal analytics wiring (replace `event()` body).
  - Logo asset / brand colour palette (research §Unresolved Q2).
  - Schema-folder grouping in Data Model sidebar.

## Unresolved Questions

- Coverage threshold — enforce in CI or leave aspirational? Plan ships without CI enforcement.
- Bundle-size budget — set a hard ceiling for `dist/` (e.g. 1.5 MB gzip)? Defer until first build measurement.
- Should `/settings` also expose a "Reload meta" button (alias for data-model refetch)? Plan omits; revisit after demo.
