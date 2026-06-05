# Phase 03 — Aggregate refresh time budget

**Item:** (5) `loadWithContinueWait` is 30s **per card**; with N cards (even parallelized at 4)
a cold/warming pre-agg can let the card phase stall far beyond any single timeout.
**Priority:** Medium. **Status:** ⬜ planned. **Layer:** server. **Depends on:** Phase 01.

## Context links
- server/src/services/load-with-continue-wait.ts (signature `(query, tokenOverride, timeoutMs)`, deadline = now + timeoutMs, polls until remaining ≤ 0)
- server/src/services/card-runner.ts (`PER_CARD_TIMEOUT_MS = 30_000`)
- server/src/jobs/refresh-segment.ts (`PER_SEGMENT_TIMEOUT_MS = 60_000`, wraps size+page loads in `withTimeout`)

## Overview
Per-card timeout bounds one card, not the phase. Add a single **wall-clock budget** for the
whole card-runner pass. Each card's effective timeout = `min(PER_CARD_TIMEOUT_MS, budgetRemaining)`.
When the budget is exhausted, remaining cards are skipped fast and recorded `status:'error'`
("refresh budget exceeded") rather than each waiting its own 30s. Bounds total card-phase time.

## Key insights
- The phase budget should comfortably exceed one wave of parallel cards but cap pathological
  cold-rollup cases. With concurrency 4 and 30s/card, a healthy run is well under 60s;
  set `CARD_PHASE_BUDGET_MS = 90_000` (≈3 waves of warming cards) as the ceiling.
- Compute remaining inline (no `Date.now()` ban here — server runtime, not a Workflow script).
  `const deadline = Date.now() + CARD_PHASE_BUDGET_MS;` then per card
  `const remaining = deadline - Date.now();`
- Cards skipped due to budget should be distinguishable from query failures (Phase 02 error
  message: `"skipped — refresh budget exceeded"`), so the UI can word it as "try refresh again".

## Requirements
- `runPresetCards` accepts/derives a phase deadline; per-card timeout clamps to remaining.
- Cards past the budget short-circuit to an error entry without issuing a Cube load.
- Total card-phase wall-time ≤ ~`CARD_PHASE_BUDGET_MS` + one in-flight wave's tail.

## Architecture
- Add `CARD_PHASE_BUDGET_MS = 90_000` constant in card-runner.
- At start: `const deadline = Date.now() + CARD_PHASE_BUDGET_MS;`
- Worker fn (from Phase 01): `const remaining = deadline - Date.now(); if (remaining <= 0) return budgetSkipEntry(id); const t = Math.min(PER_CARD_TIMEOUT_MS, remaining); await loadWithContinueWait(physical, token, t);`
- In-flight cards when budget elapses finish their own (already-clamped) timeout; only
  not-yet-started cards short-circuit. Acceptable — pool size 4 bounds the tail.

## Related code files
- Modify: `server/src/services/card-runner.ts`
- Test: `server/test/` — simulate a slow load so budget trips; assert later cards return
  `status:'error'` quickly (no full per-card wait).

## Implementation steps
1. Add `CARD_PHASE_BUDGET_MS`; compute `deadline` at pass start.
2. In worker: clamp per-card timeout to `remaining`; short-circuit when `remaining <= 0`.
3. Emit budget-skip entries via the Phase 02 error shape with a recognizable message.
4. Test with a stubbed `loadWithContinueWait` that sleeps; assert wall-time bound + skip entries.

## Todo
- [ ] Add budget constant + deadline
- [ ] Clamp per-card timeout to remaining
- [ ] Short-circuit + budget-skip entry
- [ ] Test: budget trips → fast skips, bounded wall-time
- [ ] Typecheck + suites green

## Success criteria
- With a forced slow rollup, card phase returns within ~budget; un-run cards are
  `status:'error'` ("refresh budget exceeded"), not silent absences.

## Risk assessment
- **Budget too tight on a legitimately warming cluster** → 90s ceiling chosen to absorb a
  few "Continue wait" cycles; tune via constant. Skips are recoverable next refresh.
- **Couples to Phase 02** → budget-skip uses the error-entry shape; sequence Phase 02 first.

## Security
- None.

## Open questions
- Should a budget-exceeded refresh still mark the segment `fresh` (uids succeeded) with only
  cards degraded? (lean: yes — segment size is authoritative; cards are best-effort.)
