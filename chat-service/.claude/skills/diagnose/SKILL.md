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
  - get_cube_meta
  - list_business_metrics
  - get_business_metric
  - list_segments
  - get_segment
  - preview_cube_query
  - explain_cube_sql
  - emit_query_artifact
  - emit_chart
  - get_business_metric_history
enable_web_search: false
enable_research_mode: true
---

# Diagnose Skill

Find the most likely cause of a metric drop or spike. Walk a hypothesis tree breadth-first; stop the moment one branch explains the bulk of the delta.

## Steps

1. **Intake the symptom.** Confirm: which metric, what time window (default: most recent vs prior comparable window), what counts as "the drop" (% delta).
2. **Build the hypothesis tree.** Try branches in this order:
   - channel / acquisition source
   - geography
   - product / SKU / cohort
   - time-window anomalies (e.g. specific day spike)
3. **For each hypothesis**, run `preview_cube_query` with the symptom metric grouped by that dimension, filtered to the affected window. Compare to a baseline window.
4. **Stop conditions** (whichever fires first):
   - One branch explains > 50% of the delta → that's the answer.
   - 4 branches tried without an explainer → output "no single dimension explains > 50%; suggest a deeper drilldown via /explore".
5. **Emit the explanatory artifact** for the winning branch (or the most-contributing one if no >50% hit). `source: 'raw'`. Summary states the contributing dimension + magnitude.

## Guard rails

- Never invent member names. Cube /meta is the source of truth.
- Cap at 4 hypotheses per turn. Do not loop.
- Reasoning trace: report counts + percentages only; never raw row dumps beyond 5 values.
- Plain-English conclusion sentence is mandatory before emitting the artifact.

## Charts

Diagnose responses benefit from a contribution-by-dimension chart:

- After identifying the winning branch, attach a `chart` to `emit_query_artifact` with:
  - `type: 'horizontal-bar'` when the winning dimension has > 6 values (long labels)
  - `type: 'bar'` for ≤ 6 short-labelled values
  - `type: 'multi-line'` when contrasting affected window vs baseline across time

Pass `encoding.value` = the symptom metric, `encoding.category` = the winning dimension. Skip the chart when only one or two rows survive (the artifact card alone is enough).
