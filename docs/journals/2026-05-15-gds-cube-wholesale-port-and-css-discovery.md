# GDS Cube: Wholesale Port vs. Reimplementation — CSS Silent Failure

**Date**: 2026-05-15 14:30
**Severity**: Medium
**Component**: Frontend (Vite + React, ~26.7k LOC ported from cubejs-playground)
**Status**: Resolved

## What Happened

Initial handwritten React clone (~2500 LOC) was rejected for subpar UX fidelity. Pivoted to wholesale-porting `cubejs-playground/src` (244 TS/TSX files). Integration went smoothly; build passed. Then UI reported "weirdly behaving buttons and dropdowns." Root cause: missing precompiled antd CSS — static asset oversight, not code.

## The Brutal Truth

The first 2500 LOC attempt felt efficient — custom components, streamlined routes, "reimplementing from scratch." But it exposed a hard lesson: UI fidelity isn't about writing fewer lines; it's about *preserving all the feature interactions* (Cubes/Views toggle, color-coded dimensions/measures/segments, live Result bar updates). Shipping a "simplified" version loses them silently. User's feedback was clear: "1:1 with ALL features." Copy-paste wins when complexity is irreducible.

The CSS bug is the frustrating part. The build artifact looked complete — 8053 modules, 11s compile, no errors. React mounted to `#root`. But antd's 992 KB precompiled CSS (`public/antd.min.css`) was hardcoded in the reference's `index.html` and we forgot to bring the `public/` folder or add the `<link>` tag. Every button rendered invisible. This is a classic silent failure: the JavaScript loaded perfectly; the DOM tree existed; nothing errored. Only visual inspection revealed the break.

## Technical Details

**Phase 1 → Phase 2 decision:**
- Reference: `cubejs-playground/src` = 244 files, ~26.7k LOC
- Ported via `cp -R cubejs-playground/src ./src`
- Integration touch-points: 5 files modified (index.tsx, App.tsx, Header.tsx, QueryBuilderContainer.tsx, live-preview-context.ts)
- **Key integration detail:** `App.tsx` wraps `fetch('playground/context')` in try/catch; falls back to `VITE_CUBE_TOKEN` env var or `gds-cube:token` from localStorage. No hardcoded token.

**Phase 3 — CSS bug discovery:**
Missing: `public/` folder (14 files: `antd.min.css`, favicons, manifest, logos, fonts)
Missing: `<link rel="stylesheet" href="/antd.min.css">` in `index.html`
Fix: `cp -R cubejs-playground/public ./public` + added stylesheet links + Vite auto-serves `public/*` at root

**Dependency gotcha:**
Reference lockfile pins `react-aria@3.35.1`. Later versions (3.36+) removed `useMessageFormatter`, which `@cube-dev/ui-kit@0.52.3` still imports. Reproducing the working state requires reproducing the locked versions verbatim.

## What We Tried

1. **Hand-rolled clone:** Rejected for missing UX features
2. **Wholesale port with modified entry points:** Succeeded, but silently broken styling
3. **Asset inventory:** Found missing `public/` folder + CSS link

## Root Cause Analysis

Two separate issues, same pattern: **complexity hidden behind successful builds.**

1. **Reimplementation trap:** A "simpler" custom build loses incidental feature complexity. The Cubes/Views toggle, color tokens, live preview aren't "nice-to-haves" — they're load-bearing UX. Porting preserves them automatically.

2. **Static asset amnesia:** CRA and Vite both serve `public/` by default. In a monorepo context, the reference had `public/antd.min.css` checked in and referenced via `<link>`. Our Vite config didn't error on missing `public/` — it just served an empty directory. No compilation error, no runtime error, just invisible buttons.

## Lessons Learned

- **1:1 fidelity often means copy-paste, not refactor.** If the source is 26.7k LOC and irreducible (deeply interconnected UI components, subtle feature interactions), rewriting buys you nothing except new bugs. Wholesale-port, integrate at boundaries, stub the peers.

- **Static assets in Vite need explicit confirmation.** `npm run build` succeeded even though `public/` was missing. Always inventory `public/` when porting CRA → Vite. Check for precompiled vendor CSS, favicons, manifests.

- **Dependency lockfile fidelity matters.** `react-aria@3.35.1` vs `3.36.0` is a 1-digit diff that breaks `@cube-dev/ui-kit`. Copy the reference's `package-lock.json` or `yarn.lock` verbatim, or at minimum scan for pinned versions (`@^`, exact versions) in `node_modules/.package-lock.json`.

## Next Steps

- ✅ CSS integrated, buttons render correctly
- ✅ Vite build passing at 8053 modules, 11s
- ⏳ Pending: user smoke test of Playground (`/build`) and Data Model (`/schema`) endpoints against :4000 backend
- ⏳ Pending: Rollup Designer feature (write operations) — depends on backend volume mount permissions

## Unresolved Questions

- Does the :4000 Cube backend allow write operations (DDL on models)? If read-only, Designer will be limited to read-only mode.
- Should we pin all dependency versions (lockfile committed), or just the known-breaking ones (react-aria, @cube-dev/ui-kit)?
