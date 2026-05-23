---
name: explore
display_name: Explore
description: Open-ended data exploration — translate a free-form analytics question into a clickable Cube query artifact.
trigger_keywords:
  - show
  - chart
  - revenue
  - users
  - conversion
  - daily
  - weekly
  - monthly
  - last
  - by
  - top
  - retention
  - cohort
allowed_tools:
  - get_cube_meta
  - preview_cube_query
  - emit_query_artifact
---

# Explore Skill (Phase 01 stub)

This is a stub. Full skill body lands in Phase 04. For now:

1. Call `get_cube_meta` once to learn the active game's cubes/dimensions/measures.
2. Map the user's question to measures + dimensions + a time range. Prefer the simplest valid query.
3. Call `preview_cube_query` with `limit: 10` to confirm the shape.
4. Call `emit_query_artifact` with a precise title, a one-sentence summary, the validated query, and `source: 'raw'` (no business-metric matching in Phase 01).

If the user's question is ambiguous (no time range, vague metric), ask one short clarifying question before any tool call.
