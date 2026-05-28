---
phase: 3
title: "Intent router (data | research | hybrid)"
status: pending
priority: P1
effort: "1d"
dependencies: [2]
---

# Phase 3: Intent router (`data | research | hybrid`)

## Overview
Classify the incoming question's intent BEFORE skill selection, so research questions stop
landing on `explore` (today's bug). Honor the frontend "include web context" toggle as a
hybrid floor.

## Architecture
- **Intent classifier** (`chat-service/src/core/intent-router.ts`): given the user message,
  return `'data' | 'research' | 'hybrid'`.
  - Stage 1 (cheap heuristic): trigger-keyword scan from each skill's frontmatter +
    research markers (`why`, `what is`, `state of the art`, `compare X vs market`, etc.).
  - Stage 2 (LLM classifier — optional, behind a flag): one-shot prompt to a small model
    if Stage 1 is ambiguous. Cache by message hash for the session.
- **Floor rules:**
  - If frontend sent `X-Web-Search: 1` → minimum intent = `hybrid`.
  - If `X-Research-Mode: 1` → minimum intent = `research`.
  - If neither header → use classifier result.
- **Skill selection by intent:** existing skill router restricted by intent tier — a `data`
  intent only considers data skills (`explore`, `diagnose`, `metric_explain`, `compare`); a
  `research` intent only considers `research`; `hybrid` prefers `data_with_context`.
- **Existing router** (`chat-service/src/api/turn.ts` `compose()` and the upstream skill
  picker) calls `classifyIntent` first; passes `intent_tier` through to the skill picker.
- **Tracing:** emit `intent_classification` event on `tracer` with reasoning so audit UI
  can show why a skill was chosen.

## Related Code Files
- Create: `chat-service/src/core/intent-router.ts`,
  `chat-service/test/intent-router.test.ts`
- Modify: `chat-service/src/api/turn.ts` (call classifier; pass intent into `compose()`),
  `chat-service/src/core/mode-prompts.ts` `compose()` (accept `intent`),
  upstream skill picker to filter candidate skills by intent tier

## Implementation Steps
1. Build heuristic classifier from trigger keywords + research markers.
2. Wire header floor rules.
3. Filter skill candidates by `intent_tier` (from Phase 2 frontmatter).
4. Emit trace event for audit visibility.
5. Test matrix: data Q + no toggle → data skill; data Q + web toggle → hybrid; research Q +
   no toggle → research; research Q + no skill match → fallback to `research`.

## Success Criteria
- [ ] User's original liveops question now routes to `research` (or `hybrid` if toggle on),
      not `explore`.
- [ ] Web-search toggle ON forces hybrid floor; toggle OFF allows pure data routing.
- [ ] Trace shows the chosen intent + reasoning per turn.

## Risk Assessment
- **Classifier drift** — heuristic misclassifies edge cases. Mitigation: log mismatches; bias
  to hybrid when in doubt (safer than refusing).
- **Latency from optional LLM classifier** — gate behind a flag; keep Stage 1 only by default.
- **Skill router refactor surface** — touches existing skill picker; cover with snapshot tests
  on representative turns before changing.
