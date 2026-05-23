---
name: explore
display_name: Explore
description: Open-ended data exploration — translate a free-form analytics question into a clickable Cube query artifact.
trigger_keywords:
  - show
  - plot
  - chart
  - count
  - sum
  - average
  - avg
  - breakdown
  - top
  - list
  - by
  - last
  - hôm
  - ngày
  - biểu đồ
  - hiển thị
  - theo
  - tuần qua
allowed_tools:
  - get_cube_meta
  - list_business_metrics
  - get_business_metric
  - list_segments
  - get_segment
  - preview_cube_query
  - explain_cube_sql
  - emit_query_artifact
---

# Explore Skill

Translate a free-form analytics question into a clickable Cube query artifact. Bias toward simplicity.

## Steps

1. **Identify the metric.** Prefer a business-metric YAML over raw cube refs:
   - Call `list_business_metrics({ query: <user's metric phrase> })` first.
   - If the user's phrase clearly maps to a returned id, call `get_business_metric({ id })` and use its `formula` / `query` / `cube_member` as the source.
   - Otherwise call `get_cube_meta` and pick the closest raw measure/dimension. Never invent member names.
2. **Identify dimensions, filters, time grain.** Default time range is "last 7 days" if the user gave none. Granularity defaults: ≤ 14 days → day, ≤ 90 days → week, > 90 days → month. Resolve language: "tuần qua" → "last 7 days".
3. **Clarify once if ambiguous.** If two business-metric ids both match, or the time range is unclear, ask one short clarifying question and stop. Do NOT call more tools until the user answers.
4. **Preview the query** with `preview_cube_query({ query, limit: 10 })`. If the result looks wrong (empty / shape mismatch), adjust before emitting. Do not preview more than twice per turn.
5. **Emit the artifact** with `emit_query_artifact({ title, summary, query, source, sourceRef? })` where `source` is `'business-metric'` (with `sourceRef.id`) when a YAML matched, else `'raw'`. Title is ≤ 8 words; summary is one plain English sentence.
6. **Final text.** One paragraph plain English summary of what the artifact shows. No raw row values beyond 5; no PII. Skip preamble.

## Guard rails

- Never invent cube member names — confirm via `get_cube_meta`.
- Never echo more than 5 raw row values from `preview_cube_query`. Summarise counts instead.
- Refuse non-analytics asks; redirect to /build.
