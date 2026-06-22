# Phase 04 — Distribution-first cutoff picker UI

**Move:** 2 · **Priority:** P1 · **Status:** pending · **Service:** src (FE) · **Depends:** Phase 03 (+ in-flight dry-run count)

## Context
The propose card currently shows a static est. size and (post in-flight plan) a pre-confirm count. This phase adds the visual cutoff: a histogram of the chosen measure with a draggable threshold line that updates the live cohort count.

## Requirements
- When a proposal's predicate has a **single tunable measure threshold** (e.g. `ltv_vnd >= X`, `days_since_last_active >= N`), render a histogram (from Phase 03) with a draggable line at the current cutoff.
- Dragging updates the predicate value + re-queries the live count (debounced); the count readout + bucket highlight update together.
- Fallback: if distribution is `null`/`approx` or times out, degrade to the existing numeric input (no histogram). Never block confirm.
- Reuse the chart rendering already in chat where practical; keep it lightweight (a bar strip, not a full chart surface).

## Architecture
- New `src/pages/Chat/components/cutoff-distribution-picker.tsx` (<200 lines). Props: `{ cube, measure, predicate, value, onChange }`. Fetches distribution once, holds the draggable line locally, calls `onChange` (debounced) to re-count.
- Mount inside `SegmentProposalCard` when the predicate exposes exactly one tunable numeric threshold; otherwise omit.

## Related code
- Read: `src/pages/Chat/components/segment-proposal-card.tsx`, `segment-proposal-card-parts.tsx` (StatPill), existing chat chart renderer.
- Create: `cutoff-distribution-picker.tsx`.
- Modify: proposal card to mount the picker + bind value/count.

## Implementation steps
1. Detect the single-tunable-threshold case in the proposal card.
2. Build the picker: fetch distribution, render bars, draggable line, highlight selected mass.
3. Debounced `onChange` → update predicate value → re-run count (preview/dry-run).
4. Fallback to numeric input on missing/approx distribution.
5. Design-token + dark-mode parity; cross-check adjacent cards.

## Todo
- [ ] Single-threshold detection
- [ ] Histogram + draggable line component
- [ ] Debounced re-count wiring
- [ ] Distribution-unavailable fallback
- [ ] Token/dark-mode parity

## Success criteria
- For a single-threshold proposal, dragging the line visibly moves the cohort count and highlights the selected portion of the curve.
- Multi-threshold or non-numeric predicates render the normal form (no picker, no error).

## Risks
- Drag-storm re-counts → debounce + cancel in-flight; show a subtle "counting…" state.

## Next
Move 2 shippable. Profile (Phase 05) can sit alongside the picker in the same card.
