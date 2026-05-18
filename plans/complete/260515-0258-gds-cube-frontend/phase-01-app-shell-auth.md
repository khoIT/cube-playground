# Phase 01 — App Shell + Auth

## Context Links

- Research: [`../reports/research-260515-0243-gds-cube-frontend.md`](../reports/research-260515-0243-gds-cube-frontend.md) §"Phase 1 — App shell + auth", §"Reference Auth Flow"
- Ref files:
  - `cube/packages/cubejs-playground/src/index.tsx` (router root)
  - `cube/packages/cubejs-playground/src/App.tsx` (bootstrap — strip `/playground/context` fetch)
  - `cube/packages/cubejs-playground/src/components/Header/Header.tsx`
  - `cube/packages/cubejs-playground/src/components/SecurityContext/*`
  - `cube/packages/cubejs-playground/src/hooks/cubejs-api.ts`
  - `cube/packages/cubejs-playground/src/components/AppContext.tsx`
- Blockers: [phase-00-bootstrap.md](phase-00-bootstrap.md)

## Overview

- **Priority:** P0
- **Status:** completed
- **Effort:** 1d
- Wire router, theming, header (GDS Cube brand), Cube context provider, paste-JWT modal. No `/playground/context` call — env + localStorage only.

## Key Insights

- Reference `App.tsx` fetches `GET /playground/context` for `cubejsToken`, `basePath`, `livePreview`. **GDS Cube must NOT call this** — replace with env reads.
- `SecurityContextProvider` in reference signs server-side via `POST /playground/token`. We can't sign client-side; modal accepts pre-signed JWT only.
- `@cube-dev/ui-kit` exposes a `Root` component; antd ConfigProvider should wrap it for theming.
- Token validation = call `cubeApi.meta()`; success = accept, 401/403 = surface error.
- React-router v6 uses `<Outlet/>` for layout; convert reference v5 `<Switch>` pattern.

## Requirements

**Functional**
- App boots without any `/playground/*` call.
- Header shows GDS Cube brand + nav: Playground, Data Model, Settings + "API Settings" button.
- "API Settings" button opens modal: input JWT, button "Validate & Save".
- On save: persist to `localStorage['gds-cube:token']`, re-init `cubeApi`, close modal.
- If `cubeApi.meta()` throws on app start with current token, show banner offering to open the modal.
- Routes scaffolded (lazy placeholders OK): `/playground`, `/data-model`, `/data-model/:cubeName`, `/settings`.

**Non-functional**
- Each file kebab-case; ≤200 LOC.
- No imports from `cloud/`, `live-preview/`, `vizard/`, `rollup-designer/`, `frontend-integrations/`.
- TS strict; no `any` in public API of context.

## Architecture

```
                      ┌──────────────────────┐
   env + localStorage │   cube-context.tsx   │
   ─────────────────► │  apiUrl, token,      │
                      │  cubeApi, setToken   │
                      └─────────┬────────────┘
                                │ React.createContext
                ┌───────────────┴──────────────┐
                ▼                              ▼
        useCubeApi()                  useCubeAuth()
                │                              │
                └────► consumed by QBv2, useMeta, modal
```

Layout tree:
```
<Root> (ui-kit)
  └─ <ConfigProvider> (antd 4)
      └─ <BrowserRouter>
          └─ <CubeProvider>           ← cube-context
              └─ <Routes>
                  └─ <app-layout>     ← <header/> + <Outlet/>
                      ├─ /playground          (placeholder)
                      ├─ /data-model          (placeholder)
                      ├─ /data-model/:cubeName(placeholder)
                      └─ /settings            (placeholder)
```

Data flow on token change:
1. user pastes JWT → modal calls `validateToken(token)` → `new CubeApi(token, { apiUrl }).meta()`.
2. On resolve → `localStorage.setItem`, `setToken(token)` → context recomputes memoised `cubeApi`.
3. All consumers re-render with new `cubeApi`.

## Related Code Files

**Create**
- `src/main.tsx` — Root + ConfigProvider + Router mount.
- `src/app.tsx` — top-level layout component (header + outlet + global error boundary).
- `src/context/cube-context.tsx` — provider, `useCubeApi`, `useCubeAuth`.
- `src/lib/cube-api.ts` — `getApiUrl()`, `getToken()`, `makeCubeApi()`, `validateToken()`.
- `src/lib/storage-keys.ts` — `TOKEN_KEY = 'gds-cube:token'`.
- `src/components/header/header.tsx` — top nav (≤150 LOC).
- `src/components/header/nav-links.tsx` — extracted nav items.
- `src/components/security/security-context-modal.tsx` — JWT paste modal.
- `src/components/security/use-security-context-modal.ts` — open/close hook.
- `src/components/error-boundary/error-boundary.tsx` — class component, `componentDidCatch`.
- `src/routes.tsx` — route table (lazy `React.lazy` placeholders for phase-02/03 pages).
- `src/styles/global-styles.ts` — styled-components GlobalStyle + antd less imports.
- `src/pages/_placeholder.tsx` — temporary stubs for not-yet-built routes.

**Modify**
- `index.html` — add favicon placeholder + `<title>GDS Cube</title>`.
- `src/vite-env.d.ts` — extend `ImportMetaEnv`.

**Delete** — none.

## Implementation Steps

1. Implement `src/lib/cube-api.ts`:
   - `getApiUrl()` returns `import.meta.env.VITE_CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1'`.
   - `getToken()` reads localStorage first, falls back to `VITE_CUBE_TOKEN`, then `''`.
   - `makeCubeApi(token, apiUrl)` wraps `cube()` from `@cubejs-client/core`.
   - `validateToken(token, apiUrl)` async: call `.meta()`, return `{ ok, error? }`.
2. Implement `src/context/cube-context.tsx`:
   - Provider holds `{ token, apiUrl, cubeApi, setToken, isReady, lastError }`.
   - `cubeApi` memoised on `[token, apiUrl]`.
   - `useCubeApi()` returns `cubeApi`; `useCubeAuth()` returns `{ token, setToken, lastError, validate }`.
   - On mount, call `validate(getToken())` once; set `isReady` true after resolve (success or fail).
3. Build `src/components/header/header.tsx`:
   - Logo text "GDS Cube" (placeholder until brand asset arrives).
   - NavLinks: `/playground`, `/data-model`, `/settings` (active styling via NavLink).
   - "API Settings" button → opens security-context-modal.
   - **Drop**: any links to Cube Cloud, Slack, CubeBI from reference Header.
4. Build `src/components/security/security-context-modal.tsx`:
   - Controlled antd `Modal` with `Input.TextArea` for JWT.
   - On submit: call `cubeAuth.validate(input)`. If ok → `setToken(input)` + close. If fail → show error.
   - Show current API URL + a "Clear token" button.
5. Build `src/components/error-boundary/error-boundary.tsx`:
   - Class component, captures render errors, shows fallback with reload button.
6. Build `src/routes.tsx` + `src/pages/_placeholder.tsx`:
   - `React.lazy(() => import('./pages/playground/playground-page'))` etc. — files don't exist yet; use `_placeholder.tsx` until phase-02/03.
7. Build `src/main.tsx`: `<Root>` → `<ConfigProvider locale={enUS}>` → `<BrowserRouter>` → `<CubeProvider>` → `<app />`.
8. Build `src/app.tsx`: `<ErrorBoundary>` → `<header/>` → `<Outlet/>`.
9. Update `index.html` title + meta description.
10. Smoke test: open `/playground` → placeholder renders + header visible; click "API Settings" → modal opens; paste empty token → if dev-mode Cube on :4000 → meta() returns OK; paste garbage → error displayed.

## Todo List

- [x] `src/lib/cube-api.ts` (with `validateToken`)
- [x] `src/lib/storage-keys.ts`
- [x] `src/context/cube-context.tsx` (`useCubeApi`, `useCubeAuth`)
- [x] `src/components/header/header.tsx`
- [x] `src/components/header/nav-links.tsx`
- [x] `src/components/security/security-context-modal.tsx`
- [x] `src/components/security/use-security-context-modal.ts`
- [x] `src/components/error-boundary/error-boundary.tsx`
- [x] `src/routes.tsx` + placeholder pages
- [x] `src/styles/global-styles.ts`
- [x] `src/main.tsx` rewritten
- [x] `src/app.tsx` rewritten
- [x] `index.html` updated
- [x] Manual smoke test: token validate flow works against :4000

## Success Criteria

- App boots clean; no network calls to `/playground/*` (verify in DevTools).
- Token validate flow: valid JWT → toast/banner success + persisted; bad JWT → modal shows error, no persistence.
- Reloading page restores token from localStorage automatically.
- Switching routes via header NavLinks works; URL updates; active link styled.
- All new files ≤200 LOC; `tsc --noEmit` clean.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| Reference Header imports `cloud/`/`live-preview/` indirectly | M | M | Read imports first; copy only the JSX skeleton; rewrite logic locally. | ✓ Avoided |
| `@cube-dev/ui-kit` Root + antd ConfigProvider style clash | L | M | Confirm by mounting both with one antd Button + one ui-kit Button before phase exit. | ✓ No conflict observed |
| Empty token bypass works in dev mode but fails in prod silently | M | H | Surface 401 with explicit "Token rejected by server" message; don't auto-clear stored token on first failure. | ✓ Implemented |
| Browser-history routing breaks under nginx without `try_files` | M | M | Document in `.env.example` + README that prod nginx needs SPA rewrite; alternatively keep hash router as fallback (cfg flag). | ✓ Documented |

## Security Considerations

- JWT stored in localStorage — XSS exposure. Acceptable for internal dev tool; document the trade-off in README.
- Modal shows token in `<textarea>` plain — DO NOT log to console.
- No client-side signing; we accept pre-signed tokens only (research §6 unresolved Q1 confirms this).
- `cube-api.ts` MUST NOT embed `CUBEJS_API_SECRET`.

## Next Steps

- Unblocks phase-02 (Playground port — needs CubeProvider) and phase-03 (Data Model — needs useCubeApi).
- After phase-01: switch placeholder routes to real lazy imports as phase-02/03 land.

## Unresolved Questions

- Brand asset (logo SVG) — research §Unresolved Q2 still open; phase ships text logo until provided.
- Should "Settings" route be enabled in phase-01 or deferred to phase-04? Plan defers (placeholder only).
