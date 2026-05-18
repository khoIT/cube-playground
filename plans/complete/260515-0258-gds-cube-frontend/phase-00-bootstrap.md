# Phase 00 — Bootstrap

## Context Links

- Research: [`../reports/research-260515-0243-gds-cube-frontend.md`](../reports/research-260515-0243-gds-cube-frontend.md) §"Phase 0 — bootstrap"
- Ref deps source: `/Users/lap16299/Documents/code/cube/packages/cubejs-playground/package.json`

## Overview

- **Priority:** P0 (blocker for all later phases)
- **Status:** completed
- **Effort:** 0.5d
- Vite + React 18 + TS scaffold; install deps minus the drop list; wire dev proxy and env vars.

## Key Insights

- Vite 8 requires Node ≥ 18.
- antd v4 + React 18 works with `@ant-design/compatible`; **don't bump to v5** (UI kit pinned to antd 4).
- styled-components 6, less, recharts pinned `^2.12`, react-router-dom v6 (not v5).
- Dev proxy avoids CORS; prod assumes same-origin hosting.
- `process.env.SC_DISABLE_SPEEDY` shim needed by styled-components in Vite.

## Requirements

**Functional**
- `npm run dev` serves on port 3000, proxies `/cubejs-api/*` → `:4000`.
- `npm run build` produces static bundle in `dist/`.
- `npm run test` runs vitest (jsdom).

**Non-functional**
- All file names kebab-case; no per-file >200 LOC at end of phase.
- TS strict mode on.
- No deps from drop list installed.

## Architecture

```
cube-playground/
├── package.json
├── vite.config.ts          ← proxy + react plugin + less + process.env shim
├── tsconfig.json           ← strict, paths "@/*" → src/*
├── tsconfig.node.json
├── index.html              ← <div id="root">
├── .env.local              ← VITE_CUBE_API_URL, VITE_CUBE_TOKEN
├── .env.example
├── vitest.config.ts        ← jsdom env
└── src/
    ├── main.tsx            ← placeholder (filled phase-01)
    ├── app.tsx             ← placeholder
    └── vite-env.d.ts
```

## Related Code Files

**Create**
- `package.json`
- `vite.config.ts`
- `tsconfig.json`, `tsconfig.node.json`
- `index.html`
- `vitest.config.ts`
- `.env.local`, `.env.example`, `.gitignore` (append `.env.local`, `dist/`, `node_modules/`)
- `src/main.tsx` (stub), `src/app.tsx` (stub), `src/vite-env.d.ts`

**Modify** — none.
**Delete** — none.

## Implementation Steps

1. Run `npm create vite@latest . -- --template react-ts` inside `/Users/lap16299/Documents/code/cube-playground` (root already has files — accept overwrites only for new scaffold files).
2. Install runtime deps:
   ```
   @cubejs-client/core @cubejs-client/react
   @cube-dev/ui-kit @ant-design/icons @ant-design/compatible
   antd@4.16.13 styled-components@6 less
   react-router-dom@^6 recharts@^2.12 prismjs sql-formatter
   moment date-fns mitt flexsearch fast-deep-equal uuid
   react-hotkeys-hook react-responsive html-entities best-effort-json-parser
   ```
3. Install dev deps: `@types/react @types/react-dom @types/uuid @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom`.
4. **Verify drop list NOT installed**: `@apollo/client`, `@graphiql/toolkit`, `graphiql`, `graphql-ws`, `cron-validator`, `codesandbox-import-utils`, `customize-cra`, `js-cookie`, `jwt-decode`, `react-beautiful-dnd`, `recursive-readdir`.
5. Write `vite.config.ts` with:
   - `@vitejs/plugin-react`
   - `server.port: 3000`
   - `server.proxy['/cubejs-api'] = 'http://localhost:4000'`
   - `define: { 'process.env.SC_DISABLE_SPEEDY': JSON.stringify('true') }`
   - `css.preprocessorOptions.less.javascriptEnabled: true`
   - alias `@` → `./src`
6. `tsconfig.json`: strict, `paths: { "@/*": ["./src/*"] }`, `jsx: "react-jsx"`, target ES2020.
7. `.env.local`: `VITE_CUBE_API_URL=http://localhost:4000/cubejs-api/v1`, `VITE_CUBE_TOKEN=`.
8. `src/main.tsx` stub: render `<div>GDS Cube — bootstrap OK</div>` (replaced phase-01).
9. `src/vite-env.d.ts`: declare `ImportMetaEnv` for `VITE_CUBE_API_URL`, `VITE_CUBE_TOKEN`.
10. `vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['./src/test-setup.ts']`.
11. Run `npm run dev` → confirm port 3000 loads stub; `npm run build` → confirm dist output.

## Todo List

- [x] Vite scaffold initialised
- [x] Runtime deps installed (drop list verified absent)
- [x] Dev deps installed
- [x] `vite.config.ts` written (proxy + less + SC shim + alias)
- [x] `tsconfig.json` strict + paths
- [x] `.env.local` + `.env.example` + `.gitignore` updated
- [x] `vitest.config.ts` written
- [x] Stub `main.tsx`/`app.tsx`/`vite-env.d.ts` in place
- [x] `npm run dev` boots on :3000
- [x] `npm run build` succeeds
- [x] `npm run test` runs (zero tests OK)

## Success Criteria

- Dev server reachable at `http://localhost:3000`.
- Proxy round-trip: `curl http://localhost:3000/cubejs-api/v1/meta` reaches Cube on :4000.
- `npm ls` shows zero packages from drop list.
- TS compiles clean (`tsc --noEmit`).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| Vite create overwrites repo files (CLAUDE.md, .claude/) | M | H | Run in empty `src/`; copy generated config files manually; never run create in dir with valuable contents. **Safer**: scaffold in `/tmp/gds-cube-init`, copy needed files in. | ✓ Avoided |
| antd 4 React-18 peer warnings | H | L | Use `--legacy-peer-deps` or `overrides` in package.json for react 18. | ✓ Resolved |
| less + javascriptEnabled missing → antd theme breaks | M | M | Set `javascriptEnabled: true` in vite config from start. | ✓ Resolved |
| Recharts v3 auto-installed by transitive | L | M | Explicit `recharts@^2.12` pin; verify `npm ls recharts`. | ✓ Verified v2.12 pinned |

## Security Considerations

- `.env.local` MUST be in `.gitignore`; ship `.env.example` only.
- No secrets in repo; JWT lives in localStorage at runtime only.

## Next Steps

- Unblocks: phase-01 (app shell + auth).
- Dependency on Cube backend running on :4000 is dev-time only (build can run without it).

## Deviations from Research

- **Vite version:** Plan specified Vite 8; implementation used Vite 5 (Vite 8 not released at time of execution). No functional impact — both support React 18 + TS + all required plugins.

## Unresolved Questions

- Use `npm` or `pnpm`? Plan assumes `npm`; switch needed only if team standard differs.
