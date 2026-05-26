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
  - disambiguate_query
  - list_business_metrics
  - get_business_metric
  - list_segments
  - get_segment
  - preview_cube_query
  - explain_cube_sql
  - emit_query_artifact
  - emit_chart
  - get_business_metric_history
---

# Explore Skill

Translate a free-form analytics question into a clickable Cube query artifact. Bias toward simplicity.

## Pre-flight disambiguation (REQUIRED)

Before any other tool call, run `disambiguate_query({ message: <user's full message> })`. It maps Vietnamese / English / code-switched phrases to the Official glossary, normalises numbers ("10tr" → 10000000) and dates ("3 tháng qua", "Q1 2026"), and tells you what to do next:

- `action: 'auto'` → use the returned `query` as your starting point for `preview_cube_query`. Skip step 1 of "Identify the metric" since the metric is already pinned. Still respect any `clarifications[]` warnings about edge cases.
- `action: 'clarify'` → reply in the user's `language` ('vi' / 'en' / 'mixed') with the single clarification's `question_vi` or `question_en`. If `options` is non-empty, render them as a numbered list. **Do not call any other tool until the user answers.**

### Assumption disclosure (phase 02a)

When the response carries an `assumption` field, the resolver picked one interpretation out of several plausible ones (typically a concept like "spender" mapped to its default measure + filter + ranking). After emitting the artifact, append a single-line footer in the user's language:

> Interpreted *<assumption.phrase>* as **<assumption.chosen>** (<assumption.confidence × 100>%). Reply `not that` to switch.

For the VI rendering: "Hiểu *<phrase>* là **<chosen>** (<conf>%). Trả lời `không phải` để đổi."

### "not that" handling

When the user's next message is `not that` / `không phải` / `nope` (case-insensitive, optionally with a target like `not that, try whales`), do NOT immediately re-run `disambiguate_query`. Instead:

1. If the prior turn's `assumption.alternatives[]` has a second candidate, propose it explicitly: "Try **<alt.id>** instead?" — wait for confirmation before re-querying.
2. If alternatives is empty, ask "Which one did you mean — pick from <list of nearest concept ids>?" — surface up to 3 candidates from the glossary (same `list_business_metrics` / concept aliases).

Never silently flip — the user gets a one-word fix only because they see the footer.

If `warnings[]` contains a "thousands separator" note, mention the assumed interpretation in your final summary so the user can correct it.

### Preserve original intent

When the engine returns `intent='leaderboard'` (or memory carries it forward from a prior turn), keep the leaderboard shape — entity dim + ranked measure + limit — even if the user's reply only supplies a measure. Do NOT flatten "what should I rank?" into "show me the metric"; the user asked for a ranking.

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

## Charts

When the preview returns ≥ 3 rows with a chartable shape, prefer a chart over a markdown table.

Pick `type` by shape:

| Data shape | `type` |
|---|---|
| 1 categorical (≤ 8 values) + 1 metric, share-of-whole | `pie` or `donut` |
| 1 categorical (> 8) + 1 metric, long labels | `horizontal-bar` |
| 1 categorical + 1 metric (short labels) | `bar` |
| 1 time dim + 1 metric | `line` (or `area` for cumulative) |
| 1 time dim + 1 metric + 1 breakdown | `multi-line` |
| 1 categorical + 1 metric + 1 breakdown | `stacked-bar` |
| 2 numeric metrics | `scatter` |

Rules:
- If the chart shows the **same data** as the artifact you are about to emit, pass `chart` inline on `emit_query_artifact` (one card per question). Use the same rows you saw in `preview_cube_query`.
- If the chart shows an **assistant-derived rollup** (groupings you assembled yourself, not raw query rows), call `emit_chart` standalone after the artifact.
- `stacked-bar` and `multi-line` REQUIRE `encoding.series`.
- Server truncates > 30 rows into an "Other" lump automatically.
- One chart per turn unless explicitly comparing.
