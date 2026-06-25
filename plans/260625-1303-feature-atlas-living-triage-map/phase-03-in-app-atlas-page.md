---
phase: 3
title: "In-app atlas page"
status: completed
priority: P2
effort: "2-3d"
dependencies: [1, 2]
---

# Phase 3: In-app atlas page

## Overview

Port the approved Phase-2 design into a real in-app page at `/admin/dev/atlas` (admin-gated). The page is a **pure renderer** of `src/feature-atlas/atlas.yaml` — it loads the YAML at build time via the existing `import.meta.glob('?raw')` + `js-yaml` pattern, builds a reactflow graph (reusing `src/pages/Catalog/cube-graph/` primitives), and shows a click-through detail drawer (mirroring `concept-detail`). No backend, no DB.

## Requirements

- Functional:
  - Route `/admin/dev/atlas`, gated by `authUser?.role === 'admin'` (same gate as chat-audit / advisor-audit).
  - Nav entry under the existing admin/dev section (`src/shell/sidebar/sidebar.tsx`, the `isAdmin &&` block).
  - Graph: Surface → Feature → Direction. Feature color = `health`, badge = `status`. Directions = dashed leaf nodes.
  - Filter chips (status / health / surface) + search; collapse-by-default if Phase 2 chose that.
  - Detail drawer on feature click: summary, drawbacks, directions, clickable deps (focus/centre the dep node), links (plan/code/memory paths shown; code/plan paths copyable).
  - Empty/error states: malformed or missing `atlas.yaml` shows a clear message, not a blank/crashed graph.
- Non-functional:
  - Pure renderer — zero feature-state encoded in components; all from `atlas.yaml`.
  - Loader + graph-builder are pure TS (unit-testable without React), mirroring `build-join-graph.ts`.
  - Tokens per `design-guidelines.md`; matches adjacent pages.

## Architecture

```
src/feature-atlas/atlas.yaml
        │  import.meta.glob('?raw', eager) + js-yaml.parse   (precedent: WhatsNew announcements-content.ts)
        ▼
src/pages/Atlas/atlas-data.ts        ── parse + validate (reuse P1 validator)
        │
        ▼
src/pages/Atlas/build-atlas-graph.ts ── pure: surfaces→features→direction leaves → reactflow nodes/edges
        │                                 (mirror src/pages/Catalog/cube-graph/build-join-graph.ts)
        ▼
src/pages/Atlas/atlas-page.tsx       ── reactflow board + filter chips + search
        └─ atlas-detail-drawer.tsx   ── mirror src/pages/Catalog/concept-detail right-rail
```

Reuse, do not rebuild:
- `reactflow` (package already used — import `from 'reactflow'`), `src/pages/Catalog/cube-graph/` for node/edge/floating-edge patterns + `cube-graph.css`.
- `src/pages/Catalog/concept-detail/right-rail-concept.tsx` as the drawer shape reference.
- Loader pattern: `src/pages/WhatsNew/announcements-content.ts`; YAML raw-import typing: `src/yaml-raw-imports.d.ts`.

## Related Code Files

- Create: `src/pages/Atlas/atlas-page.tsx` (route component, reactflow board, filters)
- Create: `src/pages/Atlas/atlas-data.ts` (`?raw` + js-yaml load + validate)
- Create: `src/pages/Atlas/build-atlas-graph.ts` (pure nodes/edges builder)
- Create: `src/pages/Atlas/atlas-node.tsx` (feature/surface/direction node renderers)
- Create: `src/pages/Atlas/atlas-detail-drawer.tsx` (detail drawer)
- Create: `src/pages/Atlas/__tests__/build-atlas-graph.test.ts`
<!-- Updated: Validation Session 1 — route mounts via index.tsx/tab-shell DevAudit (NOT App.tsx); atlas.yaml canonical under src/ -->
- Modify: `src/index.tsx` + `src/shell/tab-shell.tsx` (register `/admin/dev/atlas` as a tab in the existing DevAudit `/admin/dev` section — VERIFIED this is where chat-audit/advisor-audit mount, `src/pages/DevAudit/`; NOT `src/App.tsx`)
- Modify: `src/shell/sidebar/sidebar.tsx` (nav item in the `isAdmin &&` block)
- Reference: `src/pages/Catalog/cube-graph/*`, `src/pages/Catalog/concept-detail/*`, `docs/design-guidelines.md`, `src/theme/tokens.css`

## Implementation Steps

1. Add `atlas-data.ts`: import the canonical `src/feature-atlas/atlas.yaml` via `?raw` (e.g. `import rawAtlas from '../../feature-atlas/atlas.yaml?raw'`, or `import.meta.glob('../../feature-atlas/*.yaml', {query:'?raw', import:'default', eager:true})` mirroring WhatsNew). Since the file lives under `src/`, no Vite `fs.allow`/copy wiring is needed. Parse with `js-yaml`, validate with the P1 validator. Ensure `?raw` yaml typing is declared (extend `src/yaml-raw-imports.d.ts` if needed).
2. Add `build-atlas-graph.ts`: pure transform to reactflow `nodes`/`edges`; surfaces as cluster roots, features as children, directions as dashed leaves; edges for `deps`. Unit-test it.
3. Build `atlas-node.tsx` (3 node kinds) + reuse cube-graph edge/floating-edge geometry.
4. Build `atlas-page.tsx`: reactflow board + filter chips (status/health/surface) + search; collapse strategy per P2.
5. Build `atlas-detail-drawer.tsx` mirroring `right-rail-concept`; deps click → `reactFlow.setCenter` on target node; render links.
6. Wire route + admin gate + sidebar nav. Confirm the exact admin/dev mount by reading the chat-audit/advisor-audit registration.
7. Empty/malformed-yaml state. Token cross-check vs an adjacent page (Cohort/Segments). Run `tsc`/build.

## Success Criteria

- [ ] `/admin/dev/atlas` renders for admins only; hidden/forbidden for non-admins (matches chat-audit gating).
- [ ] Graph shows all `atlas.yaml` surfaces/features/directions; health color + status badge correct; directions are dashed leaves.
- [ ] Filter chips + search narrow the graph; deps clickable and centre the target node; drawer shows summary/drawbacks/directions/links.
- [ ] Editing `atlas.yaml` and reloading changes the page with **no component edits** (pure-renderer invariant proven).
- [ ] `build-atlas-graph` unit tests pass; `tsc` + build clean; tokens match adjacent pages.

## Completion notes (2026-06-25)

- User chose **all 3 views behind a toggle** (Triage swimlane · Map tree · Graph), not a single port.
- Mount: registered as a Dev sub-tab in `src/pages/Admin/hub/dev-hub-panel.tsx` (DEV_TABS + Route) — the canonical pattern its siblings (chat-audit/advisor-audit) use; already admin-gated by `index.tsx` `AdminHubRoute`. No bespoke sidebar entry (consistency over a redundant link).
- Files: `src/pages/Atlas/{atlas-types.ts, atlas-data.ts, atlas-encoding.ts, build-atlas-graph.ts, atlas-badges.tsx, atlas-detail-drawer.tsx, atlas-tree-view.tsx, atlas-swimlane-view.tsx, atlas-graph-view.tsx, atlas-page.tsx, atlas.css}` + `__tests__/{build-atlas-graph,atlas-data}.test.ts`; `src/feature-atlas/validate-atlas.d.ts`; modified `src/yaml-raw-imports.d.ts` (`*.yaml?raw`).
- Pure-renderer invariant holds: all state from `atlas.yaml` via `loadAtlas` (?raw + js-yaml + shared validator).
- Verified: typecheck-clean, 25 tests pass, `npm run build` succeeds (?raw resolves in prod), code-review no blockers (graph keyboard-a11y fix applied).
- Notes: TS discriminated-union narrowing of `if(!result.ok){…result.error}` misbehaves in this repo's config — used `'error' in result` guard. Fixed a real seed bug (comma-in-flow-map direction label) + hardened the validator to reject unexpected direction keys.

## Risk Assessment

- **Atlas file location** — RESOLVED: canonical file lives under `src/feature-atlas/atlas.yaml` so `?raw` import works with zero Vite `fs.allow`/copy wiring. `docs/feature-atlas/README.md` is a pointer only. ONE source of truth.
- **Reactflow legibility at 60 nodes** — mitigated by P2's collapse + filter decisions; carry them over, don't re-litigate.
- **Admin route mount indirection** — VERIFIED `/admin/dev` mounts via `src/index.tsx` + `src/shell/tab-shell.tsx` (DevAudit, `src/pages/DevAudit/`), not a flat App.tsx route. Read the chat-audit/advisor-audit tab registration first to slot in correctly.
- **Scope creep into an editor** — page is read-only by design. Editing stays in `/atlas reconcile`. Do not add in-page YAML editing this phase.
