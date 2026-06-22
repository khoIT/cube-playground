# Phase 03 — Multi-measure predicate authoring

## Overview
Priority: medium. Status: DONE. Chat-service only (SQL layer already supports it).

> Resolution: the capability already shipped via `propose_segment.additional_filters` + `buildAdditionalLeaves` (ANDs extra same-cube leaves onto the primary measure leaf). Adding a parallel `additional_measure_bounds` field would have been redundant (DRY), so Phase 03 reduced to: (a) explicit two-measure-bound guidance in `segment/SKILL.md` (use the second measure's catalog `dimension` as the `additional_filters` member), and (b) a proof test "spend ≥ X AND active_days ≤ Y → one AND group, two measure leaves". Column-grade gating is inherent: the agent sources the second member from `get_segmentable_measures.dimension` (a real per-user column), and `buildAdditionalLeaves` rejects cross-cube members.
Let a segment AND two+ measure bounds on the same per-user grain (e.g. `spend ≥ X AND active_days ≤ Y`).

## Key insight
`predicate-to-sql` already ANDs leaves on per-user columns. The only blocker is `kind='threshold'` emitting a single measure leaf. Measure bounds = column compares on `measure.dimension`.

## Requirements
- Verify which `get_segmentable_measures` entries are **column-grade** (have a usable `dimension` column on the per-user grain) vs aggregate. Only column-grade measures are eligible.
- Extend `propose_segment` to accept additional measure bounds — e.g. `additional_measure_bounds: [{ concept, op: gte|lte, value, value_max? }]` resolved against the catalog — ANDed onto the primary threshold leaf.
- Reject (with an actionable error) a bound on a non-column-grade / percentile-only measure; suggest expressing it as a separate percentile leaf is out of scope here.
- Skill guidance in `segment/SKILL.md`: when the user names 2+ measure conditions, build one threshold proposal with multiple bounds (not two segments).

## Related code
- Modify: `chat-service/src/tools/propose-segment.ts` (schema), `propose-segment-handlers.ts` (handleThreshold → multi-leaf), `propose-segment-disclosures.ts`, `.claude/skills/segment/SKILL.md`.

## Success criteria
- "high spenders who are also low-engagement" → one proposal, AND group with two measure leaves.
- A bound on an ineligible measure → ok:false with the reason.

## Tests
- multi-bound → N+1 leaves; ineligible measure → rejected; range + second bound combine.

## Risks
Catalog measures that are true aggregates (need GROUP BY) would produce wrong SQL as a column compare — gate strictly on the column-grade check.
