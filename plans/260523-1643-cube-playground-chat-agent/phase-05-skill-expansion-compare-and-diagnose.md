# Phase 05 — Skill Expansion: `compare` + `diagnose`

## Context Links

- Brainstorm: `/Users/lap16299/Documents/code/cube-playground/plans/reports/brainstorm-260523-1643-cube-playground-chat-agent.md` (§6 skills)
- Phase 02: `./phase-02-extended-tool-surface.md` (tools available)
- Phase 04: `./phase-04-skill-expansion-explore-and-metric-explain.md` (skill-loader + intent-router + mode-prompts patterns)
- Plan overview: `./plan.md`

## Overview

- **Priority:** P2 — analyst power-tools; not on the critical click-through path.
- **Current status:** pending (blocked by Phase 02 + Phase 04).
- **Description:** Author `compare/SKILL.md` (two-subject delta/ratio) and `diagnose/SKILL.md` (hypothesis-tree root-cause). Add intent-router keyword sets, validate that two/multi-query orchestrations terminate cleanly, write skill-prompt snapshot tests.

## Key Insights

- Brainstorm §6: `compare` issues two `preview_cube_query` calls OR one with `compareDateRange`. `diagnose` does an iterative hypothesis tree, stopping when one branch explains > N % of the symptom.
- Both skills emit `query_artifact` cards — `compare` may emit two; `diagnose` typically emits the explanatory query.
- Multi-query risk: agent loops indefinitely on unclear symptoms. Mitigation via prompt-level stop conditions + per-turn iteration cap (existing `CHAT_MAX_TOKENS_PER_TURN`).

## Requirements

### Functional

1. `compare` skill body covers: identify two subjects → build two queries (or one with compareDateRange) → preview → compute delta/ratio in prompt → emit `query_artifact`(s) → plain-English winner/loser sentence.
2. `diagnose` skill body covers: symptom intake → hypothesis tree (channels, geos, products, anomalies) → for each branch run `preview_cube_query` with filter → stop when one explains > 50 % of the drop → emit deeplink to explanatory query.
3. Intent-router adds keyword sets:
   - `compare`: `[compare, vs, versus, against, between, so với, hơn, kém]`
   - `diagnose`: `[why, drop, spike, anomaly, root cause, fell, rose, surge, tại sao, giảm, tăng đột]`
4. Both skills appear in `mode-prompts` composer; snapshot tests added.
5. Per-turn iteration cap honoured (existing config).

### Non-functional

- SKILL.md files ≤ 80 lines each.
- Snapshot tests deterministic.
- `tsc --noEmit` clean; Vitest green.

## Architecture

Reuses Phase 04 pipeline. No new infrastructure — just two more skill markdown files, two intent-router rows, two snapshot tests.

```
diagnose hypothesis flow (prompt-level only, no code):
  symptom
  ├── hypothesis: channel
  │   preview_cube_query (filter by channel)
  │   evaluate: does it explain >50% of delta?
  │     YES → emit query_artifact, stop
  │     NO  → next branch
  ├── hypothesis: geo
  ├── hypothesis: product/SKU
  └── hypothesis: anomaly window
```

Stop condition is articulated in the prompt, not enforced in code (KISS).

## Related Code Files

### MODIFY

- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/intent-router.ts` — add `compare` + `diagnose` keyword rows.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/intent-router-keywords.ts` — add keyword sets.

### CREATE

- `/Users/lap16299/Documents/code/cube-playground/chat-service/.claude/skills/compare/SKILL.md`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.claude/skills/diagnose/SKILL.md`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/intent-router-compare-diagnose.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/mode-prompts-compare-diagnose.snapshot.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/__snapshots__/mode-prompts-compare-diagnose.snapshot.test.ts.snap`

### DELETE

None.

## Implementation Steps

### 1. Author `compare/SKILL.md`

1. Frontmatter:
   ```yaml
   name: compare
   display_name: Compare
   description: Compare two subjects (segments, countries, time periods, channels) on a chosen metric
   trigger_keywords: [compare, vs, versus, against, between, so với, hơn, kém]
   allowed_tools: [get_cube_meta, list_business_metrics, get_business_metric, list_segments, get_segment, preview_cube_query, emit_query_artifact]
   ```
2. Body: 5-step list per brainstorm §6 + guard rails: "if subjects are time periods, prefer single query with `compareDateRange` over two queries"; "always state which side won and by how much in plain English".

### 2. Author `diagnose/SKILL.md`

1. Frontmatter:
   ```yaml
   name: diagnose
   display_name: Diagnose
   description: Find the most likely cause of a metric drop or spike via hypothesis-tree investigation
   trigger_keywords: [why, drop, spike, anomaly, root cause, fell, rose, surge, tại sao, giảm, tăng đột]
   allowed_tools: [get_cube_meta, list_business_metrics, get_business_metric, list_segments, get_segment, preview_cube_query, explain_cube_sql, emit_query_artifact]
   ```
2. Body: 5-step hypothesis tree per brainstorm §6 + stop conditions:
   - Stop when one branch explains > 50 % of the delta.
   - Stop after 4 branches even if no explainer.
   - Output: hypothesis tried, evidence rows (counts only, ≤ 5 sample values), conclusion sentence, link to explanatory query.

### 3. Intent-router rows

1. Append both keyword sets to `intent-router-keywords.ts`.
2. Add slash alias `/compare`, `/diagnose` in alias table.
3. `test/intent-router-compare-diagnose.test.ts`: ~6 phrases covering VN+EN + slash.

### 4. Snapshot tests

1. `test/mode-prompts-compare-diagnose.snapshot.test.ts`: compose for both skills with a fixture game context; assert snapshot.
2. Run `vitest run -u` once to commit baseline.

### 5. Wire + verify

1. `tsc --noEmit && vitest run`. Pass.
2. **Commit:** `feat(chat-service): compare + diagnose skills + intent router rows`.

### 6. Manual smoke

1. "compare revenue in PT vs CFM last 30 days" → router picks `compare` → two preview queries OR compareDateRange → two artifact cards OR one combined → text says winner.
2. "why did revenue drop yesterday?" → router picks `diagnose` → 1-3 preview_cube_query branches → terminates with explanatory artifact + plain-English conclusion.
3. Type `/diagnose stuck checkout flow` → slash override forces skill even if no keyword.

## Todo List

- [ ] 1. Author `compare/SKILL.md`
- [ ] 2. Author `diagnose/SKILL.md`
- [ ] 3. Add `compare` + `diagnose` keyword rows + slash aliases
- [ ] 4. Intent-router unit tests for ≥ 6 phrases
- [ ] 5. Snapshot tests for both skills (`vitest -u` to seed baseline)
- [ ] 6. `tsc --noEmit` clean + all Vitest green
- [ ] 7. Manual smoke for both skills + slash override

## Success Criteria

- Intent-router covers all 4 skills + slash overrides.
- Both skills' snapshots committed and stable.
- Manual smoke: `compare` produces ≥ 1 artifact card + delta sentence; `diagnose` terminates within 4 hypotheses.
- `tsc --noEmit` clean.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `diagnose` loops indefinitely on unclear symptom | Prompt-level stop conditions; per-turn token cap aborts at `CHAT_MAX_TOKENS_PER_TURN`. SDK iteration aborts when assistant emits final text without another tool_call. |
| `compare` mis-identifies subjects (e.g. "revenue vs cost" reads as a metric name) | Skill prompt explicitly: when two nouns share a connector, treat as two-subject comparison; otherwise ask one clarifying Q. |
| Snapshot fragility | Pin `gameId` + `contextPreamble` in tests; no timestamps in prompts. |
| Reasoning trace leaks raw rows | Skill prompts mandate counts/percentages over row dumps; same posture as `explore` skill. |

## Security Considerations

- Same posture as Phase 04. `diagnose` includes `explain_cube_sql` in `allowed_tools` to surface SQL transparency for power users; no new data-exposure surface (same SQL `/build` shows).

## Next Steps

- Unblocks Phase 06 (rate limits + auto-compact apply to all 4 skills equally).
- After Phase 05, full feature parity with Monet POC + the Cube-specific deeplink contract.

## Unresolved Questions

1. Should `diagnose` cap branches at 3 (cheap) or 5 (thorough)? Default: 4. Tuning is prompt-level; revisit after analyst feedback.
2. Should `compare` emit a single combined `query_artifact` when using `compareDateRange`? Default: emit one card with `summary` calling out both periods.
