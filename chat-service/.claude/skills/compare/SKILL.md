---
name: compare
display_name: Compare
description: Compare two subjects (segments, countries, time periods, channels) on a chosen metric.
trigger_keywords:
  - compare
  - vs
  - versus
  - against
  - between
  - so với
  - hơn
  - kém
allowed_tools:
  - get_cube_meta
  - get_topic_knowledge
  - list_business_metrics
  - get_business_metric
  - list_segments
  - get_segment
  - preview_cube_query
  - emit_query_artifact
  - emit_chart
enable_web_search: false
enable_research_mode: false
---

# Compare Skill

Compare two subjects on the same metric. Common patterns: segment A vs segment B, country X vs country Y, this period vs last period, channel A vs channel B.

## Steps

1. **Identify the two subjects + the metric.**
   - If the comparison is two time periods (e.g. "this month vs last month"), prefer ONE query with `compareDateRange` over two separate queries.
   - Otherwise build two queries differing only in their filter.
   - Resolve the metric via `list_business_metrics` first; fall back to `get_cube_meta` for raw measures.
2. **Resolve subjects against the catalogue.**
   - For segment names → `list_segments` then `get_segment` to confirm.
   - For country / channel / cohort → `get_cube_meta` to find the dimension.
3. **Preview each side** with `preview_cube_query({ query, limit: 10 })`. Stop at 2 previews max per turn.
4. **Compute the delta + ratio** in your reasoning. State the winner and the magnitude in plain English.
5. **Emit the artifact(s)**:
   - `compareDateRange` path → one `emit_query_artifact` with a `summary` calling out both periods.
   - Two-query path → emit two artifacts in sequence, titled with the subject name; the user can open either side in /build.

## Guard rails

- Never invent member names — confirm via `get_cube_meta`.
- Never echo more than 5 raw row values; report counts + percentages.
- If subjects are ambiguous (e.g. "compare revenue and cost"), ask one clarifying question and stop. Two-word adjacency without a connector is NOT a comparison.

## Charts

Comparisons are highly chartable. Recommended types:

- `compareDateRange` path with a single time dim → `multi-line` (two series, one per period). Pass as `chart` on `emit_query_artifact`.
- Two subjects across multiple categories → `stacked-bar` with `encoding.series` = the subject column.
- Two subjects, single metric each → `emit_chart` standalone with `type: 'bar'` and rows `[{ subject: 'A', value: ... }, { subject: 'B', value: ... }]`.

Always state the delta + ratio in the surrounding text — the chart shows magnitude, the text states the verdict.
