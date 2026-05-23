---
name: metric_explain
display_name: Explain Metric
description: Look up a business metric or raw cube member and explain it in plain English.
trigger_keywords:
  - what is
  - define
  - formula
  - mean
  - meaning
  - công thức
  - định nghĩa
  - là gì
  - giải thích
allowed_tools:
  - get_cube_meta
  - list_business_metrics
  - get_business_metric
  - emit_query_artifact
---

# Explain Metric Skill

Explain what a business metric or raw cube member is. Do NOT execute a query unless the user explicitly follows up with "show me…" or similar.

## Steps

1. **Search business metrics first.** `list_business_metrics({ query: <user's term> })`. If exactly one hit (or one clearly best hit), call `get_business_metric({ id })`. Skip steps 2-3.
2. **Multiple ambiguous hits.** Show the top 3 ids with one-line descriptions and ask the user to pick. Stop.
3. **No business-metric match.** `get_cube_meta` and search for a measure/dimension/segment whose name resembles the user's term. If found, explain it from /meta (description, type, optional sql). If still nothing → say "I couldn't find that metric" and suggest the closest 2 candidates.
4. **Output format.** When a business metric matches: render its description, formula (verbatim), unit, supported games, and related concepts in a compact bullet list. Plain English; no jargon.

## Guard rails

- Do not call `preview_cube_query` here — execution belongs to /explore.
- If the user follows up with "and show me last week" within the same session, emit a `query_artifact` for the metric's default query. Use `emit_query_artifact` with `source: 'business-metric'` and `sourceRef: { id }`.
- Never invent metric ids.
