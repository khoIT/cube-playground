# Phase 02 — Data-correctness audit (Idea 1, numbers first)

**Priority:** P0 · **Status:** 📋 planned · **Depends on:** Phase 01 (traffic ranking)

## Overview

Extend the existing `cube-parity-recorder` so it (a) covers every (game × cube × measure) the question bank exercises, (b) is **traffic-ranked** so the high-value measures audit first, and (c) **value-verifies** top-ranked measures against the `cube-prod` oracle — not just schema/PK. Output = a parity matrix persisted via migration 067 and gated in CI.

## Key insight

The recurring bug class is **silent wrong numbers**: fan-out joins (jus recharge `transid` PK fan-out), broken identity bridges (cfm `vopenid`), dual-row identity dups (jus_vn mf_users). These pass schema/PK checks but return inflated/wrong values. So the new depth is **value parity**, not structural parity: run the same logical query against dev cube and `cube-prod`, compare results within tolerance.

## What exists vs the gap

| Have (`cube-parity-recorder`) | Gap to close |
|---|---|
| (game × cube) structural/PK/schema parity vs cube-prod | Per-**measure value** parity for ranked targets |
| 🔴/🟡/⚪ finding counts, migration 067 persistence, "Run audit now" route | Traffic ranking from Phase 01 to order/limit the sweep |
| One-shot record | Parity **matrix** artifact (game × measure → verdict) + CI gate |

## Related code files

- **Modify:** `server/src/services/cube-parity-recorder.ts` — add measure-value parity pass; accept a ranked target list.
- **Modify:** `server/src/scripts/record-cube-parity-run.ts` — `--ranked <bank.json>` flag, `--top N`.
- **Create:** `server/src/services/cube-parity-value-verifier.ts` — runs logical query on dev cube + cube-prod, diffs within tolerance, classifies (match / value-mismatch / fan-out-suspect).
- **Read:** Phase 01 per-game bank (ranking + golden refs); `cube-prod` model as oracle.
- **CI:** add `audit:cube-parity-record` gate script asserting new-🔴 count == 0 vs frozen baseline.

## Implementation steps

1. Resolve ranked target set: from Phase 01, the measures actually referenced by asked+synthesized questions, frequency-ordered.
2. Value verifier: for each target, build the minimal logical query (measure over a fixed recent window + 1 standard breakdown), execute on dev cube and on cube-prod, compare totals + per-row within relative tolerance.
3. Classify: exact/within-tolerance = match; divergent = value-mismatch; dev ≫ prod on a joined cube = **fan-out-suspect** (flag for the known PK fan-out shape).
4. Persist verdicts into the existing migration-067 store; emit a parity matrix (game × measure → verdict) report under this plan's `reports/`.
5. Freeze a baseline; wire CI gate (fail build when a new 🔴 correctness/fan-out finding appears).

## Success criteria

- Parity matrix covers 100% of bank-referenced measures across modeled games.
- Every known historical bug shape (transid fan-out, vopenid bridge, jus dup rows) is **re-detected** by the value verifier on a regression fixture (proves sensitivity).
- Deterministic, re-runnable; CI gate fails on new 🔴.
- Findings surface in the Model Audit console (reuses existing route).

## Risks / mitigations

- **cube-prod availability / cost:** prod queries can be slow/cold (Trino 3.5–15s) → bound windows, cache, run ranked-top-N not full sweep.
- **Tolerance tuning:** legitimate dev↔prod drift (model evolution) ≠ bug → tolerance + an allowlist of known-intentional divergences, reviewed not auto-suppressed.
- **Accepted-posture guard:** this is correctness only — do NOT fold in the accepted cross-tenant/header-gate trade-off (`[[prod-cross-tenant-reads-accepted]]`).

## Unresolved questions

- Q1: Relative tolerance for value parity (1%? exact for counts, 1% for sums)?
- Q2: cube-prod oracle = local `/Users/lap16299/Documents/code/cube-prod` model run, or live prod data plane? (value parity needs real data both sides — confirm which plane is the trusted source.)
