---
phase: 2
title: Migrate Shell (T.* + raw neutral)
status: completed
priority: P1
effort: 1.5d
dependencies:
  - 0
  - 1
---
<!-- Updated: Validation Session 1 - gate each batch on Phase 0 visual harness (light + dark) -->


# Phase 2: Migrate Shell (T.* + raw neutral)

## Overview

Migrate the 66 `src/shell/*` files off the `T.*` color proxy and the 20 files off raw `var(--neutral-*)` onto the semantic tokens established in Phase 1. After this phase no component reads a raw scale; `T` retains only `cx`, `Icon`, and font helpers.

## Key Insights

- `T.*` is a typed accessor — its DX value is autocomplete/type-safety, not the indirection. Replace color members with semantic CSS-var strings; keep the non-color helpers.
- Because Phase 1 made `--hermes-*` alias semantic tokens, each `T.shell` → `var(--surface-shell)` swap is a no-op visually — that's the safety guarantee.
- 20 files use `var(--neutral-*)` directly; each maps to a semantic token via the Phase 1 table (e.g. a divider neutral → `--border-card`, a muted bg neutral → `--bg-muted`). Do NOT preserve the raw neutral; that re-introduces the dual-role footgun.

## Requirements

- Functional: shell chrome (sidebar, topbar, panels, collapse, breadcrumb, bell) and the 20 raw-neutral files render identically in light + dark.
- Non-functional: `T` color members removed; `theme.tsx` keeps `cx`/`Icon`/`CHART`/font constants; no inline hex introduced.

## Architecture

- Introduce a thin migration: for each `T.<colorMember>`, the Phase 1 doc gives the semantic replacement. Apply as direct `var(--…)` string in `style={{}}` / tasty css.
- `CHART` palette stays (it is an ordered categorical palette, not a semantic surface) but is sourced from `--chart-1..n` semantic tokens where already defined.
- Delete color members from the `T` object last, once grep shows zero references — TypeScript will flag any miss.

## Related Code Files

- Modify: 66 files importing from `src/shell/theme` (sidebar/*, topbar/*, pane chrome, etc.) — full list via `grep -rl "from .*shell/theme" src`.
- Modify: 20 files with `var(--neutral-*)` (non-theme) — full list via `grep -rl "var(--neutral-" src | grep -v theme/`.
- Modify: `src/shell/theme.tsx` (remove color members from `T`; keep helpers).

## Implementation Steps

1. Generate the authoritative file lists (commands above) and the `T.member → --semantic` swap table from Phase 1.
2. Migrate shell files in small directory-scoped batches (sidebar → topbar → pane/panels → misc). After each batch: `tsc --noEmit` + run the Phase 0 visual gate (light + dark) for the affected routes.
3. Migrate the 20 raw-neutral files; map each neutral to its semantic intent (never keep the raw var).
4. Once `grep` shows zero `T.<color>` and zero non-theme `var(--neutral-*)`, delete the color members from `T`. Resolve any `tsc` errors (they pinpoint missed references).
5. Full light/dark walkthrough of all shell chrome + the 20 surfaces.

## Success Criteria

- [ ] Zero `T.<color>` references in `src/**`; `T` exposes only `cx`/`Icon`/`CHART`/fonts.
- [ ] Zero `var(--neutral-*)` in non-theme component files.
- [ ] Phase 0 visual gate passes for shell chrome + migrated surfaces, light + dark.
- [ ] `npx tsc --noEmit` clean.

## Risk Assessment

- **Risk:** a `T` color member mapped to the wrong semantic token (e.g. `surfaceMuted` vs `bg-muted`) shifts a shade. **Mitigation:** Phase 1 value-diff table is the source of truth; spot-check resolved hex per batch.
- **Risk:** overlap with in-flight nav-bar plans on `src/shell/*`. **Mitigation:** confirm those plans' status before starting; sequence after them if active (see plan.md Dependencies).
- **Risk:** tasty/ui-kit css strings differ from inline style handling. **Mitigation:** batch by file type; verify a ui-kit surface early.
