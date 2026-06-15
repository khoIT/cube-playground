---
phase: 1
title: Token Contract & Safe Aliasing
status: completed
priority: P1
effort: 1d
dependencies:
  - 0
---
<!-- Updated: Validation Session 1 - depends on Phase 0 gate; add --chart-6..8; gate via visual harness -->


# Phase 1: Token Contract & Safe Aliasing

## Overview

Establish the single semantic-token contract and make the parallel raw scales (`--hermes-*`, `--neutral-*`) *alias* it — with **zero visual change**. This is the safety net: after this phase, every surface still reads its old token names, but those names now resolve through one canonical layer. No component files change.

## Key Insights

- Semantic tokens are currently *defined in terms of* raw neutrals (`--text-primary: var(--neutral-900)` light / `var(--neutral-50)` dark). The same raw token means different things per theme — `--neutral-50` is a cream surface in light but primary text in dark. That dual-role is the dark-mode footgun.
- `--hermes-*` (34) and `--neutral-*` (12) are two raw scales expressing overlapping intentions. Both must funnel into the same semantic vocabulary.
- The semantic vocabulary already covers most needs (`--bg-app/card/muted`, `--border-card/strong`, `--text-primary/secondary/muted`, status `--*-soft/--*-ink`, `--radius-*`, `--shadow-*`, `--font-*`). Gaps to fill: explicit **surface tiers** (shell / sidebar / topbar / panel — currently only in `--hermes-*`), and any chart/brand-variant values that live only as hex or hermes vars.

## Requirements

- Functional: a documented mapping from every raw value → its semantic token; raw scales aliased so the rendered app is identical light + dark.
- Non-functional: no dual-meaning primitives in the final contract design (document the target even if the alias is interim); contract lives entirely in `src/theme/tokens.css`.

## Architecture

Target three-tier model, all in `tokens.css`:

1. **Primitives (private):** single-meaning raw values, theme-agnostic names (e.g. `--cream-100`, `--ink-900`, brand/status hues). A primitive never changes role between light and dark.
2. **Semantic tokens:** the contract components read — `--bg-card`, `--border-strong`, `--text-primary`, `--surface-shell/sidebar/topbar/panel`, status, radius, shadow, font. Each maps to primitives, re-pointed per theme in the `:root` / `[data-theme="dark"]` blocks.
3. **Compat aliases (interim, deleted in Phase 4):** `--hermes-* : var(--<semantic>)` and, where a component reads a raw neutral, keep `--neutral-*` resolving to the same value it does today.

This phase introduces the surface-tier semantic tokens and the alias wiring; it does NOT yet rip the dual-role neutrals apart in a way that changes output — that lands as components migrate (Phase 2/3) so each change is independently verifiable.

## Related Code Files

- Modify: `src/theme/tokens.css` (add surface-tier + any missing semantic tokens; repoint `--hermes-*` to alias semantic tokens).
- Modify: `src/shell/theme.tsx` (no API change; confirm `T.*` still resolves — values now flow through semantic layer).
- Create: `docs/design-guidelines.md` mapping section (raw → semantic table) — append to existing file, do not fork.

## Implementation Steps

1. Audit: enumerate every distinct value in `--hermes-*` and `--neutral-*` and every recurring inline hex (from Phase 3 grep), bucket by intent (surface / border / text / brand / status / chart).
2. Add missing semantic tokens to `tokens.css` for intents only expressible via raw vars today — notably surface tiers: `--surface-shell`, `--surface-sidebar`, `--surface-topbar`, `--surface-panel` (mirror current `--hermes-shell/sidebar/topbar/panel`). Also add `--chart-6`, `--chart-7`, `--chart-8` so the full 8-color `CHART` palette in `theme.tsx` is token-defined (`--chart-1..5` already exist); repoint `CHART` to read these tokens.
3. Repoint `--hermes-*` definitions to `var(--<semantic>)` (alias). Verify `T.shell` etc. render identical bytes.
4. Document the canonical contract + raw→semantic mapping table in `docs/design-guidelines.md` (this becomes the migration key for Phases 2–3 and the lint allowlist source in Phase 4).
5. Define the target primitive set (single-meaning) in the doc so Phase 2/3 migrations point at the right semantic name (not a dual-role neutral).

## Success Criteria

- [ ] `tokens.css` exposes a complete semantic vocabulary (incl. surface tiers) covering every current raw-var intent.
- [ ] `--hermes-*` are pure aliases of semantic tokens; `T.*` output unchanged; `--chart-1..8` defined and `CHART` reads from them.
- [ ] **Phase 0 visual gate passes** (light + dark, all covered routes) with no diff — aliasing is provably a no-op.
- [ ] `docs/design-guidelines.md` carries the raw→semantic mapping table + the target three-tier model.
- [ ] `npx tsc --noEmit` clean for any touched `.ts/.tsx`.

## Risk Assessment

- **Risk:** aliasing a hermes var to a semantic token that itself resolves to a re-tinted neutral changes a color. **Mitigation:** value-level diff each alias (resolved hex must match the pre-change resolved hex) in both themes before moving on.
- **Risk:** missing an intent (no semantic token fits) → temptation to inline. **Mitigation:** add the semantic token instead; that's the whole point.
