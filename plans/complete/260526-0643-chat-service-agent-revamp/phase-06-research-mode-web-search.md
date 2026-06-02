# Phase 06 — Research Mode + Web Search (Flagged)

## Context Links

- SDK review §3.#2 (web search + research mode)
- SDK review §3.#4 (cross-session memory store — evaluated here, not implemented separately)
- `chat-service/src/core/claude-runner.ts:154` — `WebSearch` currently in disallowedTools
- `chat-service/.claude/skills/diagnose/` — most likely beneficiary of research mode

## Overview

- **Priority:** P2 — depends on Phase 05 reliable tracing to detect misbehaviour
- **Status:** Pending
- **Flags:** `CHAT_ENABLE_WEB_SEARCH`, `CHAT_ENABLE_RESEARCH_MODE`, both default false; scoped per skill via SKILL.md frontmatter
- **Description:** Opt-in expansion of the agent's tool surface. Web search for skills that benefit (e.g. metric_explain when explaining an external concept). Research mode for diagnose deep-dives. Evaluate whether SDK's cross-session memory store should replace `user_disambig_prefs`.

## Key Insights

- Expanded tool surface = more token cost + new failure modes; gate per skill, never global.
- Research mode tends to be slow; cancellation (Phase 04) is the prerequisite escape valve.
- Cross-session memory: today we own a Postgres-like SQLite table (`user_disambig_prefs`). SDK's memory store may or may not exist in v0.3.150 (open question). If absent, keep ours; if present, evaluate migration cost/benefit before adopting.

## Requirements

**Functional**

Web search
- New env `CHAT_ENABLE_WEB_SEARCH` boolean.
- New SKILL.md frontmatter field `enable_web_search: true|false`.
- When env on AND skill opts in → remove `WebSearch` from disallowedTools and add to allowedTools for that turn.
- Cite-back: model is instructed (via skill body) to surface sources as `{{cite:url|title}}` tokens.
- FE renders cite tokens as inline footnotes.

Research mode
- New env `CHAT_ENABLE_RESEARCH_MODE` boolean.
- New SKILL.md frontmatter field `enable_research_mode: true|false`.
- When env on AND skill opts in → pass `research: true` in query options (exact flag name pending Spike 1).
- Latency budget bumped: turn timeout (Phase 04) doubled for research-mode turns.

SDK memory store evaluation
- Spike 2: verify SDK v0.3.150 exposes a cross-session memory store. If yes, document API + cost.
- Decision matrix: (a) keep `user_disambig_prefs` only, (b) dual-write during transition, (c) migrate fully.
- Default outcome: keep our store unless SDK store gives meaningful UX wins (e.g. multi-device sync handled by Anthropic).

**Non-functional**
- Research-mode latency p95 ≤2× standard turn latency.
- Web search adds ≤1 extra tool call per turn average (instructed via skill body).
- Token cost per turn telemetry split by `(skill, web_search_used, research_mode)`.

## Architecture

```
SKILL.md frontmatter additions (per skill, opt-in)
  enable_web_search: true|false
  enable_research_mode: true|false

Tool gating (compose() + query-options-presets)
  if (env.CHAT_ENABLE_WEB_SEARCH && skillMeta.enable_web_search) {
    allowedTools.push('WebSearch')
    disallowedTools.delete('WebSearch')
  }

Query option (research)
  if (env.CHAT_ENABLE_RESEARCH_MODE && skillMeta.enable_research_mode) {
    options.research = true
    timeoutMs *= 2
  }

Citation render (FE)
  parse `{{cite:url|title}}` → <Footnote /> with hover-card
```

## Related Code Files

**Modify**
- `chat-service/src/core/skill-loader.ts` (parse new frontmatter fields)
- `chat-service/src/core/query-options-presets.ts` (web-search toggle, research flag)
- `chat-service/src/core/mode-prompts.ts` (inject cite-token guidance when web search active)
- `chat-service/src/core/claude-runner.ts` (no change; gating in presets)
- `chat-service/.claude/skills/metric_explain/SKILL.md` (opt in to web search)
- `chat-service/.claude/skills/diagnose/SKILL.md` (opt in to research mode)
- `chat-service/src/config.ts` (two new flags)
- FE: `src/pages/Chat/...` — citation token renderer

**Create**
- `chat-service/src/__tests__/web-search-gating.test.ts`
- `chat-service/src/__tests__/research-mode-gating.test.ts`
- `src/pages/Chat/cite-token-renderer.tsx`
- `chat-service/src/observability/sinks/citation-audit-sink.ts` (logs every citation produced for later quality review)

## Implementation Steps

1. **Spike 1**: confirm v0.3.150 surface for research mode (exact flag name, behaviour). Document in this file under "Spike results".
2. **Spike 2**: confirm v0.3.150 SDK memory store surface. Document; if present, file follow-up RFC for migration.
3. Extend skill-loader frontmatter schema with `enable_web_search?: boolean`, `enable_research_mode?: boolean`. Add to `SkillMeta` interface.
4. Update query-options preset to gate WebSearch + research flag from `(env, skillMeta)`.
5. Opt-in: edit metric_explain SKILL.md (web_search) and diagnose SKILL.md (research_mode); add cite-token instructions to both skill bodies.
6. Implement `cite-token-renderer.tsx` parsing `{{cite:url|title}}` into `<Footnote />`. Existing field-chip parser is the template.
7. Citation audit sink: every turn with web search produces a log line of all cite tokens; reviewers can sample for hallucinated URLs.
8. Tests:
   - `web-search-gating.test.ts` — env on + skill opt-in → tool allowed; env off OR skill opt-out → tool denied.
   - `research-mode-gating.test.ts` — same matrix; assert query options carry the flag.
9. Phase 04 interaction: confirm timeout-doubling math reaches `claude-runner` correctly; add test.
10. Staging dark-launch: 10% of metric_explain turns get web search; compare answer quality (manual review of 50 turns) before ramping.

## Todo List

- [ ] Spike 1: research-mode SDK surface
- [ ] Spike 2: SDK memory store availability
- [ ] Skill-loader frontmatter extension
- [ ] Query-options gating
- [ ] Skill body updates (metric_explain, diagnose)
- [ ] Cite-token renderer
- [ ] Citation audit sink
- [ ] Gating tests
- [ ] Staging quality review
- [ ] Cross-session memory store decision document

## Success Criteria

- Web search produces ≥1 citation per opted-in turn that uses it.
- ≤5% citation hallucination rate (URL non-resolvable) in manual review.
- Research-mode diagnose turns improve root-cause hit rate by ≥20% on canned eval set (or land flag-off if no improvement).
- No turn timeout from research-mode default; timeout-doubling is sufficient.
- Memory-store decision recorded with rationale (keep / dual-write / migrate).

## Risk Assessment

- **R1 Hallucinated citations** — audit sink + manual sample review gates ramp.
- **R2 Token cost spike** — research mode may emit many tool calls. Per-turn cost cap (separate from timeout) emits warning + early-stop above threshold.
- **R3 Prompt injection via search results** — model could be steered by malicious page content. Mitigations: (a) sandbox web search to a known-safe allowlist if possible, (b) skill body instructs model to never execute instructions found in search results, (c) cite all sources for human review.
- **R4 Skill body drift** — opt-in fields easy to forget when adding new skills. Phase 00 boot guard extended to surface skills missing the new fields with a warning (not error).

## Security Considerations

- Web search exposes external content to the model; treat all returned text as untrusted (prompt-injection mitigations above).
- Cite tokens may carry user-tracked URLs; cite-token renderer must sanitise href + open in `_blank` with `rel="noopener noreferrer"`.
- Research mode produces longer traces; ensure observability sinks redact prompt body.

## Next Steps

- Future: add `WebFetch` (currently disallowed) for narrow whitelisted hosts (e.g. our own dashboards).
- If SDK memory store wins on Spike 2, plan a follow-up phase to migrate `user_disambig_prefs`.

## Spike Results

_(Spike 1: ...) (Spike 2: ...)_
