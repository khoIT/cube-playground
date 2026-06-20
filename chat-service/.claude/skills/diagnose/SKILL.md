---
name: diagnose
display_name: Diagnose
description: Find the most likely cause of a metric drop or spike via hypothesis-tree investigation.
trigger_keywords:
  - why
  - drop
  - spike
  - anomaly
  - root cause
  - fell
  - rose
  - surge
  - tại sao
  - giảm
  - tăng đột
allowed_tools:
  - decompose_metric
  - get_metric_benchmark
  - recommend_actions
  - care_queue
  - get_cube_meta
  - get_topic_knowledge
  - list_business_metrics
  - get_business_metric
  - list_segments
  - get_segment
  - preview_cube_query
  - explain_cube_sql
  - emit_query_artifact
  - emit_combined_artifact
  - emit_chart
  - get_business_metric_history
  - offer_choices
enable_web_search: false
enable_research_mode: true
---

# Diagnose Skill

Run one coherent rail: **diagnose → conclude → recommend.** Find the most
likely cause of a metric drop or spike, conclude with a benchmark-aware verdict,
then offer cited actions for the top driver. Do not stop at the diagnosis — the
conclusion is only the midpoint.

Prefer the deterministic decomposition engine over a hand-rolled walk: it
decomposes the goal into growth-accounting factors, runs several independent
lenses, and ranks the weakest factors with a confidence score. Fall back to a
manual hypothesis walk only when the engine is unavailable.

## Steps

1. **Intake the symptom.** Confirm: which metric/goal (revenue or engagement),
   the scope (whole game, or a specific segment), and the comparison window
   (default: most recent vs prior comparable window).
2. **Decompose.** Call `decompose_metric` with the game, scope, and goal. Read
   the ranked `opportunities` — each names a `factor`, its `gapPct`/`gapValue`
   vs the population baseline, `confidence` (how many lenses agree it is weak),
   and `agreeingLenses`. The top opportunity is the prime suspect.
   - If the result is `ok:false reason:"advisor-disabled"` or
     `"engine-unavailable"`, say so briefly and use the **Manual fallback**.
   - If it returns `blocked`, report that the data could not be diagnosed (do
     not silently probe around it).
   - Only set `deeper:true` on an explicit "dig deeper" follow-up (adds latency).
3. **Benchmark the suspect.** For the top opportunity's metric, call
   `get_metric_benchmark` to fetch the internal portfolio percentile band and
   the external published norm. Use it to say not just "this factor is weak"
   but "weak relative to <internal band> / <external norm>".
4. **Conclude (MANDATORY benchmark-aware narrative — before any artifact).**
   One plain-English verdict naming, for the top opportunity:
   - the **factor** and its **magnitude** (`gapPct` and/or `gapValue`),
   - its standing vs the **internal percentile band** AND the **external norm**,
   - the **confidence** (`confidence` count / `agreeingLenses`).
   If a benchmark side is unavailable (`available:false` or null), say so
   explicitly — never fabricate a band or norm.
5. **Emit the explanatory artifact** for the suspect factor. `source: 'raw'`.
   Cite the engine's provenance (the Cube sources it returned) in the summary.
6. **Offer to recommend.** After the conclusion, offer actions for the top
   driver — e.g. "Want the recommended actions for <factor>?". If the user's
   original ask was already prescriptive ("what should I do about X"), skip the
   ask and go straight to Step 7 in the same turn.
7. **Recommend cited strategy — where the rail ends.** Call `recommend_actions`
   (segment scope, or whole-game with `params.addressableN`). Render the top
   candidates as **strategy proposals**; for EACH state its citation from the
   payload: **source engine + triggering signal + benchmark** (internal band /
   external norm, or "no benchmark available yet").
   - Frame each strategy against the **cohort/segment** it targets so the user can
     take it forward themselves — build the segment, brief the team, run the test.
     The playground stays a data-exploration tool: it proposes the cited strategy
     and stops there. It does NOT perform care, experiment, or any other write,
     and there is no confirm-to-write step. The user decides and acts in their own
     tools.
   - Append the returned `caveats` verbatim in spirit: **blind spots** ("cannot
     assess X — no data path") and any **withheld** levers with their missing
     cubes. Never present a blind spot as a strategy.
   - `care_queue` is read-only reference — use it to show which CS playbooks
     already exist for a lever, not to enqueue or act on anything.

## Manual fallback (engine unavailable only)

Walk a hypothesis tree breadth-first; stop when one branch explains the bulk of
the delta:
- branches in order: channel / acquisition → geography → product/SKU/cohort →
  time-window anomalies.
- for each, run `preview_cube_query` grouped by that dimension over the affected
  window vs a baseline.
- stop when one branch explains > 50% of the delta, or after 4 branches output
  "no single dimension explains > 50%; suggest a deeper drilldown via /explore".

## Trust & blind-spot guardrails

- **No uncited action.** Render an action only with its `{sourceEngine,
  triggeringSignal, benchmark}` citation from the tool payload. `recommend_actions`
  already drops uncited candidates; never reconstruct or re-add a dropped one
  from prose.
- **Never invent** member names, percentile bands, external norms, or signals.
  The engine, Cube /meta, and the benchmark tool are the sources of truth.
- **Blind spots are not actions.** Surface them as "cannot assess — no data
  path" (e.g. competitive-integrity cheating). Never phrase a blind spot, or a
  withheld lever, as a recommendation.
- **Genre honesty.** Only recommend what the game's data supports — e.g. a
  social-MMORPG with no guild/gacha/PvP data must never be told to act on clan
  or gacha levers; those arrive withheld and stay withheld.
- The benchmark-aware conclusion (Step 4) is mandatory and comes before the
  artifact. State explicitly when a benchmark is missing rather than guessing.
- Reasoning trace: report counts + percentages only; never raw row dumps beyond
  5 values. Manual fallback caps at 4 hypotheses per turn. Do not loop.

## Charts

Diagnose responses benefit from a contribution-by-dimension chart:

- After identifying the winning branch, attach a `chart` to `emit_query_artifact` with:
  - `type: 'horizontal-bar'` when the winning dimension has > 6 values (long labels)
  - `type: 'bar'` for ≤ 6 short-labelled values
  - `type: 'multi-line'` when contrasting affected window vs baseline across time

Pass `encoding.value` = the symptom metric, `encoding.category` = the winning dimension. Skip the chart when only one or two rows survive (the artifact card alone is enough).
