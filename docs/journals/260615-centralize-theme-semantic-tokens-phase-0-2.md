# Centralize theme onto semantic tokens — Phases 0–2

**Date:** 2026-06-15
**Plan:** `plans/260615-1812-centralize-theme-semantic-tokens/`
**Commits:** `7be2382` (gate) · `8b9c016` (contract) · `b362ebf` + `c843937` (retire `T.*`) · `262751c` + `a47321c` (plan sync)
**Status:** Phases 0–2 done, gate-green, not pushed. Phases 3–4 deferred.

## Why

The UI ran three parallel color systems: the `--hermes-*` raw scale via the `T.*` JS proxy (shell), the `--neutral-*` raw scale, and inline hex in 161 files. Surfaces drifted and dark mode was fragile. Goal: one semantic-token contract, UI pixel-intact in **both** themes at every step.

## What shipped

- **Phase 0 — visual gate first.** Extended the mock-only Playwright harness into a real route gate: `tests/visual/routes.manifest.ts` + `theme-routes.spec.ts`, 12 routes × light+dark = 24 committed baselines. Theme forced via `data-theme` (re-asserted post-hydration — server-pref reconciliation can otherwise flip it), motion frozen, live data masked. Proven to bite (perturbing `--bg-app` failed the expected light routes). `npm run test:visual:theme[:update]`.
- **Phase 1 — token contract, provable no-op.** Added `--surface-{shell,sidebar,topbar,panel,raised,muted,subtle}` carrying the exact frame values; aliased the `--hermes-surface*/shell/sidebar/topbar/panel` to them. Three-tier model (primitives → semantic → compat aliases) + migration key documented in design-guidelines §10–11.
- **Phase 2 — retire the `T.*` color proxy app-wide.** All `T.<color>` usage eliminated across **66 files** (shell, App, chat-search, every Chat component, the DevAudit triage UI). `T` now exposes only font stacks. Added the full `--shell-*` family (neutral ramp, bg, brand, status). Gate extended with `/chat` + `/dev/chat-audit`; 24/24 green; 522 unit tests pass.

## Key decisions / insights

- **The shell palette is intentionally distinct — preserve, don't unify.** `--hermes-*` diverges from the content palette in *both* themes: cool-grey vs warmed-cream borders in light, blue-black vs grey frame in dark. That is the deliberate "Actioneer two-tone" frame shipped days earlier. So migration mapped onto `--shell-*` tokens carrying the **exact** former values (pixel-intact *by construction*) rather than snapping to content `--text-*/--border-*`/status tokens — the latter also lack dark variants, which would have shifted dark-mode status colors.
- **CHART must stay literal hex.** It feeds recharts `fill`/`stroke` **SVG presentation attributes**, where CSS `var()` does not resolve. Promoting it to `var()` would have silently broken every chart — and the visual gate *masks* charts, so it wouldn't have caught it. Resolution: a `--chart-series-1..8` source-of-truth token family; `CHART` mirrors it as literals and remains the single Phase-4 lint allowlist entry. (Also: pre-existing drift — `--chart-3` teal `#009688` ≠ `CHART[2]` green `#059669`, distinct consumers — kept separate rather than unified.)
- **The gate is the arbiter, and it has blind spots.** Masked regions (charts, the cohort heatmap, the DevAudit session list) are *not* verified by pixels — so changes there must be reasoned about (exact-value preservation) or checked another way. A green gate ≠ "everything verified"; it means "the unmasked surfaces match within tolerance."
- **Scope correction.** The plan claimed `T.*` was "used exclusively by `src/shell`" — wrong, it spanned 66 files app-wide. Verifying real usage with grep before sizing the work would have caught this earlier; the "14 files" estimate I gave mid-flight was a `src/shell`-scoped grep, not the true consumer set.

## Gotchas for next time

- **Concurrency.** A parallel session was editing Advisor/Segments/experiments throughout. Every commit staged explicit paths (never `git add -A`, never `git stash`); zero overlap. Phase 3 (161-file hex sweep) *does* collide with those files — sequence it when that session is idle.
- **Pre-existing, unrelated:** DevAudit `cache-*` files carry committed type errors (`TopQueryRow.dollarsSaved/queryKey/snippet`, `CacheEffectivenessResponse.byKind`). Confirmed present at HEAD; this refactor's diffs there are color-only. Needs a separate fix.

## Remaining

- Phase 3 — inline-hex sweep (161 files; collides with concurrent session) + the 20 raw-`var(--neutral-*)` files.
- Phase 4 — eslint/stylelint + pre-push hook; `--hermes-*` is now fully orphaned and safe to delete.
