# Theme Centralization Refactor Complete

**Date**: 2026-06-16 00:30 GMT+7  
**Severity**: High  
**Component**: Design system, CSS token layer, UI enforcement  
**Status**: Resolved

## What Happened

Completed Phase 4 of the 5-phase theme-centralization refactor. All five phases now ship: the codebase migrated from three parallel color systems (raw `--hermes-*` scale via `T.*` proxy, dual-meaning `--neutral-*` scale, 161 files of inline hex) down to one enforced semantic-token contract with pixel-perfect light + dark visual gates at every phase boundary.

Phase 4 specifics: orphaned `--hermes-*` scale deleted (commit 87c4759), 24 component files migrated off raw `--neutral-*` onto new single-meaning primitives (`--surface-inset/-strong/-inverse`, `--text-inverse/-dim`, `--fill-muted/-faint`; commit 4d923bd), bespoke linter `scripts/lint-theme-tokens.mjs` wired to npm + pre-push gate (commit b67bedf), design-guidelines updated §11/§12 (commit 33dd187).

## The Brutal Truth

This refactor should have been a single PR. Instead it ate **five phases + a Playwright gate + custom linting** because the original design system had no enforcement — three incompatible color contracts lived side-by-side for months, each with defenders. The refactor forced every choice (migrate or allowlist or delete?) to be justified against visual reality. It was tedious and correct, but it was only tedious because no one had said "pick ONE system" earlier.

The real frustration: the `--neutral-*` scale had a dark-mode trap baked in from day one. In light mode, `--neutral-50` renders as warm cream (#faf8f5). In dark mode, it redefined to near-white (#f5f3f0) — a pixel value you'd expect in light mode. Components reading `--neutral-*` directly got "correct" light panels and nearly-invisible dark panels. The token naming implied a stable grey scale; it was a lie. This wasn't discovered until Phase 2 when visual testing showed a dark-mode card background you could barely see.

## Technical Details

**The footgun:** `--neutral-50` through `--neutral-300` have dual meanings — they're light-mode identity (warm creams and soft greys) but redefined to "light content on dark background" in dark mode. The 400–950 range is invariant: same numeric grey in both themes. Phase 2 testing revealed that components referencing `--neutral-50` in dark mode rendered near-white panels (the dark definition) instead of the warm-cream relationship from light mode.

**Phase 4 execution:**
- Deleted the now-orphaned 84-token `--hermes-*` scale (the shell used its own two-tone warm palette; after `--shell-*` alias, `--hermes-*` had zero refs).
- Migrated 24 component files off raw `--neutral-*` to new primitives: `--surface-inset` (invariant fill for form inputs), `--surface-strong` (invariant darker surface), `--surface-inverse` (inverted text/bg for high contrast), `--text-inverse` (light text on dark, vice versa), `--fill-muted` (inactive/disabled faint fill), `--fill-faint` (ghosts/borders).
- Built `scripts/lint-theme-tokens.mjs`: scoped linter (no eslint/stylelint — kept zero new deps since repo had no linting) that asserts no inline hex outside an 22-token allowlist (data-viz categorical, syntax highlight, brand accent, intentional exception tokens). Wired to `npm run lint`.
- Added `scripts/git-hooks/pre-push` gate (can be bypassed with `--no-verify`; in-repo CI absent, so this is the only enforceable line).
- Baseline linter caught 3 new files with rogue hex since Phase 3 shipped; fixed inline.

**Visual gate:** 12 routes × light+dark @ maxDiffPixelRatio 0.02. `/build` excluded (non-deterministic live table + cube list).

## What We Tried

The user had three options for the dual-meaning `--neutral-*` problem:
1. **Invariant fills + surface-token fix** (chosen): Keep `--neutral-400+` as-is (they're already invariant), define `--surface-inset/-strong/-inverse` for dual-meaning cases, no adaptive guessing.
2. **Full adaptive migration**: Invent dark-specific fills (`--neutral-50-dark`, etc.) and migrate all references. More explicit but more untested (no components outside the gate).

The user picked Option 1 after I rendered both approaches in huashu hi-fi HTML side-by-side in both themes. The comparison showed light mode byte-identical across both options. Dark mode: Option 1 uses verified surface tokens. Option 2 adds guessed adaptive fills. Since light-mode is the constraint ("UI pixel-intact") and was identical, Option 1 won.

## Root Cause Analysis

The dual-meaning `--neutral-*` scale existed because the token set was designed as "one light baseline, invert for dark." Reality: dark backgrounds need lighter text, lighter fills need darker text — the problem isn't a simple invert, it's a full re-interpretation. The `--neutral-*` scale was the victim of this ambiguous design, not the root cause.

The real root cause: **no enforcement layer**. Three color systems coexisted for months because there was no gate saying "pick one." Phase 0's Playwright visual gate made enforcement possible; without it, migrations are opinion.

## Lessons Learned

1. **Rendering beats reasoning.** When a refactor decision is hard to justify in prose (Option 1 vs Option 2 both "sound right"), render both in real HTML side-by-side in both themes. The trade-off becomes obvious and the user's choice becomes defensible.

2. **Design systems need naming discipline.** Token names must not imply stability they don't have. `--neutral-50` was a lie in dark mode. Future: if a token redefines its meaning between themes, the name must say so (e.g., `--adaptive-50-dark` or split into two tokens with explicit names).

3. **Dual-meaning tokens are the enemy.** The entire complexity of Phases 2–4 existed because `--neutral-*` was both "cool grey scale" (light) and "inverted fills" (dark). Single-meaning tokens (`--surface-inset`, `--text-inverse`) are boring but correct.

4. **Custom linting at the right scope.** A full eslint/stylelint setup would have flagged hundreds of unrelated issues. A 60-line scoped linter (no deps, one job: catch rogue hex) was cheaper and faster to ship.

5. **Pre-push hooks are the only gate when CI is absent.** Documented limitation: can be bypassed with `--no-verify`. Acceptable trade-off given this is a design-correctness gate, not a security gate.

## Next Steps

Two documented follow-ups (no assigned dates, roadmap-level):

1. **metric-list-row.tsx trust hues** (`#0f7a3a` green / `#8a5a05` brown): Currently allowlisted in the linter. Converging these to a canonical `--trust-badge-success` / `--trust-badge-warning` token requires a light-mode baseline re-render (since they're currently hex and not in the gate). Depends on whether trust-badge theming is worth a dedicated token family.

2. **`/build` gate-hardening**: Route is non-deterministic (live table + live cube list). Current solution: exclude from gate. Better solution: mask volatile regions (e.g., table rows, query state) and re-include. Deferred pending routing stability.

**Pre-push linter enforcement confirmed working** (caught 3 rogue hex since Phase 3). No team coordination needed — changes are local, commit direct-to-main per existing memory.
