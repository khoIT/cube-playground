---
phase: 2
title: "Skill catalog: research + data_with_context + prompt provenance"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Skill catalog — `research` + `data_with_context` + prompt provenance

## Overview
Add the two missing skills (research / hybrid) and embed provenance rules into every skill's
system prompt so the model knows which tool tier owns which kind of claim. This closes the
exact gap that caused web-search to do nothing for the user's liveops question.

## Architecture
- **New `research` skill** (`chat-service/.claude/skills/research/SKILL.md`):
  - `allowed_tools:` WebSearch, Atlassian.* (read), Read, Grep, Glob.
  - `enable_web_search: true`. `enable_research_mode: true` (longer timeout).
  - Body teaches: gather sources → cite per claim → if user asks for numeric/data fact
    that requires Cube, **route them to `explore`/`diagnose`** (don't fabricate). Output
    structure: question framing → evidence with citations → caveats.
- **New `data_with_context` hybrid skill**
  (`chat-service/.claude/skills/data_with_context/SKILL.md`):
  - `allowed_tools:` full data toolset (Cube MCP) + enrichment (WebSearch, Atlassian, Read).
  - `enable_web_search: true`.
  - Body is a **two-phase script**:
    1. **Phase A — Data answer.** Same as `explore`: disambiguate → Cube query → emit
       artifact. Numbers come from Cube only.
    2. **Phase B — Context (optional).** If the question has a "why"/"what's"/"explain"
       component or the user toggled web-context, append one paragraph under a literal
       heading `### Context (not data)` with citations. Forbidden: any numeric claim in
       Phase B; if context introduces a stat, route the user to a follow-up query.
- **Existing data skills (`explore`, `diagnose`, `metric_explain`, `compare`)** — minor
  prompt patch: add a "Provenance" section instructing them to emit `sources` for every
  claim block and to refuse non-data asks with a redirect to `research`/`data_with_context`.
- **Skill loader** (`chat-service/src/core/skill-loader.ts:47`) — propagate two new flags
  parsed from frontmatter: `intent_tier: 'data' | 'research' | 'hybrid'` and
  `provenance_kinds: string[]` (which source chips the skill can emit).

## Related Code Files
- Create: `chat-service/.claude/skills/research/SKILL.md`,
  `chat-service/.claude/skills/data_with_context/SKILL.md`
- Modify: `chat-service/.claude/skills/explore/SKILL.md` (add Provenance section + redirect rule),
  same for `diagnose`, `metric_explain`, `compare`
- Modify: `chat-service/src/core/skill-loader.ts` (parse `intent_tier`, `provenance_kinds`)
- Modify: `chat-service/src/core/mode-prompts.ts` (expose new fields)

## Implementation Steps
1. Author `research/SKILL.md` and `data_with_context/SKILL.md` per architecture.
2. Add a Provenance section to the 4 existing data skills with the redirect rule.
3. Extend frontmatter parser for `intent_tier` + `provenance_kinds`.
4. Smoke test: route each skill manually with sample turns and inspect tool_calls_json.

## Success Criteria
- [ ] `research` skill answers a research question with WebSearch + Atlassian, no fabricated numbers.
- [ ] `data_with_context` answers a hybrid question with a Cube artifact and a "Context (not data)" block.
- [ ] Existing data skills still refuse non-data asks but now redirect to `research`/`data_with_context`.
- [ ] Skill loader exposes `intent_tier` + `provenance_kinds` to mode-prompts consumers.

## Risk Assessment
- **Prompt regressions on existing skills** — Provenance section text could confuse the
  model. Mitigation: minimal, declarative additions; snapshot tests for existing turn shapes.
- **Hybrid skill scope creep** — model may answer Phase B with numbers. Mitigation: explicit
  forbidden examples in the prompt + validator catches it in Phase 6.
