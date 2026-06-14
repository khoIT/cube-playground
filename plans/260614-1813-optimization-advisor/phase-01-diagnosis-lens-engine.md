# Phase 01 — Diagnosis lens engine (9 lenses + synthesis)

> The v1 differentiator. The predictive/uplift model (D) isn't available, so the Advisor's power comes from
> **triangulating many descriptive lenses**. An opportunity confirmed across several angles is trustworthy;
> one that shows on a single metric is a maybe.

## Overview
- **Priority:** P0.
- **Status:** pending.
- Given `(segment|game, goal)`, compute the descriptive lenses on-demand against the ops cubes, decompose the
  goal tree, and synthesize ranked **opportunities** each carrying a confidence = # lenses agreeing.

## The lenses (per product doc §Multi-angle)
| # | Lens | Built from | v1 priority |
|---|---|---|---|
| 1 | Level vs population (A) | Cube percentile of the factor (uses Phase 0 percentile) | sync |
| 2 | Trajectory (C) | factor over trailing 30/60/90 windows | sync |
| 3 | Peer / look-alike (B) | within-game peer Segment (uses Phase 0 derived+percentile) | sync |
| 4 | Decomposition (growth accounting) | Payers×ARPPU×lifespan; freq×length×lifespan | sync (drives the bottleneck) |
| 5 | Concentration / Pareto | Gini / top-decile share | lazy |
| 6 | Funnel / conversion | engaged→payer→repeat→whale stage rates | lazy |
| 7 | Lifecycle / cohort | behavior by tenure band | lazy |
| 8 | Cross-signal correlation | pairwise corr over members (CS-contact↔retention, method↔churn, freq↔spend) | lazy |
| 9 | Anomaly / change-point | change detection on the factor series | lazy |

**Sync set = A, B, C, decomposition** (renders the diagnosis immediately); **lenses 5–9 lazy-load**
(mitigates the cold-Trino cost, open Q#5). Each opportunity = a weak factor in a goal tree, with the gap
quantified and the agreeing lenses listed.

## Key insights
- **Decomposition (#4) is the spine** — it picks *which* factor is the bottleneck (theory-of-constraints);
  A/B/C then say whether that factor is genuinely weak (low percentile, declining, below peers). Confidence
  = how many of those agree on the same factor.
- **On-demand live Cube read** (locked decision #4) — read the ops cubes per segment on open; no precompute store in v1.
- **Engagement tree needs session freq/length/lifespan** wired alongside revenue (locked #2) — confirm these
  exist per-segment in game_integration cubes for cfm/jus (open Q#3) before wiring lens #4's engagement branch.
- **Reuse the cube member resolver** (memory `cube-member-resolver-workspace-abstraction`) for logical→physical member names; don't hardcode cube names.

## Requirements
Functional:
1. `diagnosis-engine.ts` — `diagnose(input: {scope: SegmentRef|GameRef, goal: 'revenue'|'engagement'|'both', asOf, options})` → `Diagnosis`.
2. `Diagnosis` = `{ goalTrees: GoalTree[], opportunities: Opportunity[], lenses: LensResult[] }`.
   - `GoalTree` = factors with value + baseline + weak flag.
   - `Opportunity` = `{ factor, gapPct, gapValue, levers?, confidence, agreeingLenses: number[] }`.
   - `LensResult` = `{ id, verdict, inputs, method, provenance: PlaygroundLink }` (provenance is required — Phase 3 renders it).
3. Each lens a small pure-ish function `lens-<n>-<name>.ts` reading via a shared cube-query helper; A/B/C/decomp eager, 5–9 behind a `lenses?: number[]` request param.
4. **Synthesis** — map lens verdicts onto goal-tree factors; confidence = count agreeing; rank opportunities by gap × confidence.

Non-functional: each lens carries its own provenance (measure + dims + filter + source cube/table + rows); short-circuit empty cohort; total budget guard on lens count.

## Related code files
Create (under `server/src/advisor/`):
- `diagnosis-engine.ts`, `diagnosis-types.ts`
- `goal-tree.ts` (revenue + engagement decomposition)
- `lenses/lens-01-level.ts` … `lens-09-anomaly.ts`
- `lens-synthesis.ts`
Read for context: ops cubes (`billing_detail`/`billing_lifetime`/`cs_ticket_detail`/`user_identity`); `member-profile-runner.ts`; cube member resolver; Phase 0 percentile resolver.

## Implementation steps
1. `diagnosis-types.ts` + `goal-tree.ts` (both trees, engagement marked leading-indicator).
2. Shared cube-query helper that records provenance for every read.
3. Implement A/B/C + decomposition (sync set) first; verify on segment `5ee78131…` / cfm_vn → expect payer-lifespan as the weak factor (matches worked example).
4. `lens-synthesis.ts` — factor-level confidence; rank.
5. Implement lenses 5–9 as lazy add-ons.
6. Compile + a smoke test that the sync set returns within an acceptable cold-Trino budget.

## Todo
- [ ] `diagnosis-types.ts` + `goal-tree.ts`
- [ ] provenance-recording cube-query helper
- [ ] lenses A/B/C + decomposition (sync)
- [ ] `lens-synthesis.ts` (confidence = # agreeing)
- [ ] lenses 5–9 (lazy)
- [ ] smoke test on `5ee78131…` → payer-lifespan weak factor
- [ ] confirm engagement measures exist per-segment (open Q#3) before wiring engagement branch

## Success criteria
- `diagnose(5ee78131…, revenue)` returns payer-lifespan as the top opportunity with ≥3 agreeing lenses and a quantified ₫ gap, each lens carrying a working Playground provenance link.
- Sync set (A/B/C/decomp) renders without waiting on lenses 5–9.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| 9 lenses × cold Trino too slow | H×M | sync 4 / lazy 5; short-TTL cache if it bites (open Q#5). |
| Engagement measures missing per-segment | M×H | confirm Q#3 first; degrade to revenue-only tree with a labeled note if absent. |
| Confidence inflated by correlated lenses | M×M | weight independent angles; document that A and percentile-of-A are one signal, not two. |

## Security (PII)
Lenses aggregate; member-level only via the masked ranked-members API. No contact columns.

## Next steps
Phase 2 maps opportunities → levers → power-checked experiments. Phase 3 renders lenses + provenance.
