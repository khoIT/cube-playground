# Chat message redesign — spacing / chips / highlighted terms

Status: DONE (2026-06-17). tsc clean on the 3 files; 201 Chat + 13 concept-chip tests
green; theme-token lint clean; code-reviewer pass (one dark-mode token note resolved by
switching the term hover ink to `--shell-brand-hover`). Direction chosen by user from 3
huashu variations: **C (expressive
editorial)** as base, with two amendments:
- Highlighted glossary terms: C's baseline underline-accent BUT **drop the ⓘ icon** so
  terms blend into the prose.
- Action chips: take **B's "Suggested next step"** band + button treatment.

Mockups: `design-demos/variation-{a,b,c}-*.html` (+ `SPEC.md`).

## Problems being fixed
- P1: inline glossary-term pills (`ConceptChip` brand tone) are ~24px tall on a ~22px
  line box → wrapped pills touch the row above. Underline-accent terms add **zero box
  height** → cannot collide.
- P2: action chips vs answer turns share too similar a register → turns get a brand
  left-rail card; action chips get a distinct "suggested next step" band with bold ▸.

## Changes (all chat-scoped; verified `tone="brand"` + `DisambigChips` used only in chat)
1. **`src/components/concept-chip/concept-chip.tsx`** — when `tone==='brand'`: render an
   inline (not inline-flex) underline-accent link/button, **no icon**, hover grows the
   2px soft-orange underline into a full soft fill. Default/other tones unchanged
   (catalog/build keep the typed pill + icon).
2. **`src/pages/Chat/components/disambig-chips.tsx`** — `'choice'` slot becomes B's
   next-step band: top divider + faint muted band, the prompt as its label, chips as
   solid soft-brand pill buttons with a 15px ▸ that fills/lifts/nudges on hover. Engine
   slots (metric/dimension/timeRange) keep the quiet neutral pill.
3. **`src/pages/Chat/components/assistant-message.tsx`** — wrap the turn body in C's
   `.answer` card: 1px border + 3px brand left-rail + radius-card + soft shadow + padding;
   keep the existing logo/Cube/cache/timestamp header inside the card top; body flush
   (drop the 31px hanging indent). Respect `compact`.

## Verify
- `npx tsc --noEmit` clean.
- Existing chat tests green (disambig rehydrate, chip suppression, glossary linker).
- code-reviewer pass (regression check: dark mode, compact mode, streaming memo).

## Out of scope
- Whether to show the disambig prompt at all (separate prior concern). Engine-slot chip
  styling. The chart-card and composer (mockup-only stubs).
