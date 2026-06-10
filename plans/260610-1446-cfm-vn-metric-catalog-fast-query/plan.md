---
title: "cfm_vn metric catalog — Trino-grounded, wide, fast (<2s warm)"
status: pending
created: 2026-06-10
owner: thinm@vng.com.vn
scope: cfm_vn first; per-game roll-out template after
---

# cfm_vn Metric Catalog — Grounding + Fast-Query + Seed Rebuild

## Goal

Make the metrics catalog (`/catalog/metrics`) the curated, **Trino-grounded** set of
things users can explore for **cfm_vn**, where every listed metric (a) actually resolves
against cfm's modeled cubes and (b) serves **warm <2s from CubeStore** for the common
slice (last-30d, headline dimensions). Rebuild seeded questions from the final list.
cfm_vn first; the same steps become a per-game template.

## Why now

Catalog = 57 metrics over 6 logical cubes (recharge, active_daily, mf_users, funnel,
retention, user_recharge_daily). All 6 exist for cfm_vn (some as `sql:`-defined cubes),
so **availability is mostly fine — speed is not**: recharge has no daily rollup, ratios
span cubes (ARPDAU fanout), and several cubes hit cold Trino. Plus cfm has unmodeled
event tables (money_flow, lottery_shoot, prop_flow, room/team match, newbie funnels) =
latent exploration width not in the catalog.

## CRITICAL: the catalog is also the chat agent's vocabulary

`chat-service` consumes the catalog as its retrieval surface — `tools/list-business-metrics.ts`
+ `get-business-metric.ts` (selectable metrics), `nl-to-query/synonym-resolver.ts` +
`tools/resolve-query-terms.ts` (phrase→metric via ids+synonyms), and its own
`core/starter-question-*` subsystem (separate from `src/pages/Chat/library/starter-questions.ts`).
So **registry edits + reseeding move agent accuracy** (rollup edits don't, except where they
change query shape/value, e.g. ARPDAU). Net effect is likely positive (drop dead metrics,
dedup, richer synonyms) **only if** guarded by a resolution-regression harness — hence Phase 0.
Rules: pruning never deletes a matchable synonym (fold into survivor); additions ship with
synonyms+description; curation picks that choose one source over another ARE source-routing
decisions and must be surfaced, not silent.

## Decisions (locked with user)

- Deliverable: **plan → implement cfm_vn** (build after plan approval).
- Width: **curate the 57 + propose additions** from cfm event tables.
- Latency bar: **warm <2s from CubeStore**; cold-Trino acceptable only for unusual slices.

## Foundational facts (verified this session)

- `recharge.recharge_date` and `active_daily.log_date` are the **identical** SQL expr →
  date axis already conformed (ratios blend cleanly on the day key).
- Ratio handling: same-cube ratios = post-agg measures (arppu pattern, already done);
  cross-grain ratios (arpdau) = conform denominator into a daily mart OR product-layer blend.
- Rollup correctness rules: time-dim must match query; additive measures only; verify by
  compiled SQL / `usedPreAggregations`, not assumption. (see docs/lessons-learned.md)

## Phases

| # | Phase | Status | Output |
|---|-------|--------|--------|
| 0 | Chat-agent resolution-baseline harness | pending | eval harness + **before** baseline of current metric-resolution + ARPDAU query shape |
| 1 | Availability & Trino-grounding audit | pending | per-metric matrix: resolvable / broken / stub / no-data; cfm recharge PK verdict; verdicts wired to availability |
| 2 | Width curation + event-table proposals | pending | final curated cfm_vn metric list (dedup; synonyms preserved) |
| 3 | Per-metric fast-query (rollup) design | pending | rollup spec per cube to hit <2s warm |
| 4 | Implement cfm_vn semantic layer | pending | rollup YAMLs + restart + <2s verification; PK hard-gate |
| 5 | Rebuild seeded questions + agent surface | pending | regenerated seeds across all 3 sources incl. chat-service starters |
| 6 | Per-game roll-out template | pending | repeatable doc for other games |

Phase 0 is also the **gate**: re-run after Phases 2, 4, 5 — accuracy must not regress vs the
captured baseline before each ships.

## Key dependencies

- Phase 0 runs FIRST (baseline before any edit); re-run as gate after 2/4/5.
- Phase 3 needs Phase 1 (what's broken + cfm PK verdict) + Phase 2 (final list).
- Phase 4 needs Phase 3 spec; requires Cube restart (DEV_MODE=false) + partition seal;
  **blocked** on Phase-1 cfm recharge PK verdict (rollup dedups on PK).
- Phase 5 needs Phase 2 final list + Phase 4 (only seed metrics that are fast).
- Phase 6 generalizes after cfm_vn ships.

## Out of scope (this round)

- Other games (cfm_vn only; Phase 6 is just the template).
- The full metric-source-routing/resolution-policy layer (mf_users vs mart DAU as declared
  variants + intent resolver) — separate effort. BUT: where curation must pick one existing
  source over another for a metric (e.g. revenue=recharge vs an mf_users equivalent), that
  pick is in-scope and must be surfaced — it's not a silent reroute.
- Coalesced care-sweep plan (260609-2323-*) — unrelated, untouched.

## Comms note

ARPDAU (and any metric fed by the jus-style PK fix / ratio reshape) changes value once the
fix routes — e.g. inflated→correct revenue. Record in a changelog so it doesn't read as a
regression to anyone watching cfm_vn dashboards.
