# Phase 04 — Skill Expansion: `explore` + `metric_explain`

## Context Links

- Brainstorm: `/Users/lap16299/Documents/code/cube-playground/plans/reports/brainstorm-260523-1643-cube-playground-chat-agent.md` (§4.3 skill loader, §4.4 intent router, §6 skills)
- Phase 01: `./phase-01-chat-service-skeleton-and-core-tools.md` (skill-loader, intent-router stub, explore skill stub)
- Phase 02: `./phase-02-extended-tool-surface.md` (tools `list_business_metrics`, `get_business_metric` available)
- Plan overview: `./plan.md`

## Overview

- **Priority:** P1 — turns the placeholder `explore` skill into a real prompt and adds `metric_explain`. Promotes intent-router from stub to keyword heuristic.
- **Current status:** pending (blocked by Phase 01 + Phase 02).
- **Description:** Author full `SKILL.md` bodies for `explore` (translate NL → Cube query) and `metric_explain` (look up business metric YAML, explain formula/unit/related concepts). Replace intent-router stub with keyword heuristic (VN + EN). Add LRU TTL config + snapshot test for prompt composition.

## Key Insights

- Brainstorm §6 lists exact step lists for both skills — these go in `SKILL.md` body verbatim (rephrased for tone).
- Brainstorm §4.4: keyword heuristic returns `{ skill, confidence, autoRoute }`; explicit `/explore` or `/metric` prefix always wins.
- Skill files are content, not code — non-engineers can edit. Restart or wait for LRU TTL (5 s dev) to reload.
- Brainstorm §17 row 6: snapshot tests cover prompt composition, not LLM behaviour (no live LLM in CI).

## Requirements

### Functional

1. `explore` skill body covers: 1) identify metric (business-metric YAML > raw measure), 2) identify dims/filters/time grain, 3) ask one clarifying Q if ambiguous, 4) run `preview_cube_query` (≤ 10 rows), 5) emit `query_artifact`, 6) one-paragraph plain-English summary.
2. `metric_explain` skill body covers: 1) `list_business_metrics` then `get_business_metric` by id, 2) on hit → render description/formula/unit/game_compatibility/related_concepts, 3) on miss → fall back to `get_cube_meta` and explain raw measure/dimension, 4) execute only on explicit follow-up like "and show me last week".
3. Intent router upgraded: keyword sets per skill, VN + EN. Slash prefixes `/explore`, `/metric` force-route.
4. Skill-loader TTL configurable via env `SKILL_LOADER_TTL_MS` (default 5000 in dev, 60000 in prod).
5. Snapshot test asserts `mode-prompts.compose({ skill: 'explore', ... })` and `.compose({ skill: 'metric_explain', ... })` produce stable strings.

### Non-functional

- Skills under 60 lines each (KISS).
- `tsc --noEmit` clean.
- Vitest suite green; new tests deterministic (no time-based flakes).

## Architecture

```
User message
  ↓
intent-router.detect(text)
  ├── slash prefix → { skill, autoRoute: true, confidence: 1 }
  ├── keyword match (highest score) → { skill, autoRoute: score>=0.6, confidence: score }
  └── no match → { skill: null, autoRoute: false, confidence: 0 }
  ↓
mode-prompts.compose({ master, skill, contextPreamble?, gameId })
  ├── reads master command   (.claude/commands/cube-playground.md)
  ├── reads SKILL.md body    (skill-loader cache)
  └── concatenates with section separators
  ↓
claude-runner.run({ systemPrompt: composed, tools: filterBySkill(allTools, skill.allowed_tools) })
```

### Intent-router keyword sets (initial)

```
explore: [show, plot, chart, count, sum, average, breakdown, top, list, by, last, hôm, ngày, biểu đồ, hiển thị, theo, tuần qua]
metric_explain: [what is, define, formula, mean, công thức, định nghĩa, là gì, giải thích]
```

Ties → no autoRoute (let LLM choose). `/skill <name>` slash prefix overrides.

## Related Code Files

### MODIFY

- `/Users/lap16299/Documents/code/cube-playground/chat-service/.claude/skills/explore/SKILL.md` — replace stub body with full content.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/intent-router.ts` — replace stub with keyword heuristic.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/skill-loader.ts` — make TTL configurable from env.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/mode-prompts.ts` — ensure `compose` filters tools by `allowed_tools` frontmatter and exposes the filtered list for `claude-runner`.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/config.ts` — add `SKILL_LOADER_TTL_MS`.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.env.example` — add `SKILL_LOADER_TTL_MS=5000`.

### CREATE

- `/Users/lap16299/Documents/code/cube-playground/chat-service/.claude/skills/metric_explain/SKILL.md` — full content.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/intent-router-keywords.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/skill-loader.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/mode-prompts.snapshot.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/__snapshots__/mode-prompts.snapshot.test.ts.snap` — generated.

### DELETE

None.

## Implementation Steps

### 1. Author explore SKILL.md

1. Replace `chat-service/.claude/skills/explore/SKILL.md` body (frontmatter retained from Phase 01 + extended `allowed_tools` from Phase 02). Body uses numbered steps per brainstorm §6. Include guard rails: "never invent cube member names — always confirm via `get_cube_meta`. Prefer business-metric YAML formulas over raw measure refs."

### 2. Author metric_explain SKILL.md

1. Create `chat-service/.claude/skills/metric_explain/SKILL.md` with frontmatter:
   ```yaml
   name: metric_explain
   display_name: Explain Metric
   description: Look up a business metric or raw cube member and explain it in plain English
   trigger_keywords: [what is, define, formula, mean, công thức, định nghĩa, là gì, giải thích]
   allowed_tools: [get_cube_meta, list_business_metrics, get_business_metric, emit_query_artifact]
   ```
2. Body: 4-step list per requirement 2; explicit refusal of query execution unless user adds "and show me…".

### 3. Intent-router upgrade

1. Replace stub with: parse slash prefix → keyword scoring → return highest. Slash overrides always autoRoute.
2. Keyword map declared in `intent-router-keywords.ts` (sibling module) to keep router thin.
3. `test/intent-router-keywords.test.ts`: assertions for ~10 phrases (VN + EN), tie cases, slash override.

### 4. Skill-loader TTL config

1. `skill-loader.ts`: read `Config.skillLoaderTtlMs`. Use `lru-cache` with `ttl` option.
2. `test/skill-loader.test.ts`: temp dir with two synthetic skills; assert frontmatter parse + cache hit/miss after TTL expiry (use `vi.useFakeTimers`).

### 5. mode-prompts filter + snapshot

1. `mode-prompts.compose` now returns `{ systemPrompt, allowedToolNames }`. `claude-runner` uses `allowedToolNames` to subset the tool registry passed to SDK.
2. `test/mode-prompts.snapshot.test.ts`: composes for `explore` with a fixture game context and for `metric_explain`; matches snapshot. Determinism: pin date / no timestamps in prompts.

### 6. Wire + verify

1. `tsc --noEmit && vitest run`. Pass.
2. **Commit:** `feat(chat-service): real explore + metric_explain skills + keyword intent router`.

### 7. Manual smoke

1. Ask "what is ROAS?" → router picks `metric_explain` → tool call sequence is `list_business_metrics` (search) → `get_business_metric` → text only, no query_artifact.
2. Ask "show daily DAU last 14 days" → router picks `explore` → `get_cube_meta` → `preview_cube_query` → `emit_query_artifact` → card.
3. Type `/metric DAU` → slash override forces `metric_explain` regardless of phrasing.

## Todo List

- [ ] 1. Replace `explore/SKILL.md` body with brainstorm §6 step list + guard rails
- [ ] 2. Author `metric_explain/SKILL.md` (frontmatter + 4-step body)
- [ ] 3. Intent-router keyword heuristic + slash-prefix override + tests
- [ ] 4. Skill-loader TTL configurable from env + tests
- [ ] 5. `mode-prompts.compose` returns filtered tool names + snapshot test
- [ ] 6. Wire `claude-runner` to use filtered tool list + `tsc --noEmit` clean
- [ ] 7. Manual smoke for 3 phrases (`metric`, `explore`, slash)

## Success Criteria

- Intent-router routes 10 sample VN+EN phrases to the correct skill with ≥ 90 % accuracy.
- `mode-prompts.compose({ skill: 'explore' })` and `.compose({ skill: 'metric_explain' })` produce stable snapshots.
- `claude-runner` receives only the `allowed_tools` subset per skill (other 6 tools invisible to `explore`'s LLM call — well, all 8 listed; for `metric_explain` only 4).
- All Vitest suites green; `tsc --noEmit` clean.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Keyword heuristic mis-routes (e.g. "what's the formula and show me a chart") | Tie → no autoRoute; LLM with master + both skills available falls back to whichever it picks. Slash override is the user escape hatch. |
| Snapshot test churn when skill bodies edit | Acceptable — snapshot updates are PR-visible diffs. |
| SKILL.md frontmatter typo crashes loader | Loader logs error + skips that skill; service continues with remaining skills. Test covers malformed frontmatter. |
| LRU TTL leaks file edits in prod | Default 60 s in prod is acceptable; restart on demand. |
| Skill prompts leak instructions across skills | `mode-prompts.compose` includes only the selected skill's body. Snapshot test verifies. |

## Security Considerations

- Skill prompts forbid echoing > 5 raw row values; mirror Monet POC posture (brainstorm §12 last row).
- `metric_explain` cannot call `preview_cube_query` (not in `allowed_tools`) — enforces the "no execution unless asked" rule at tool level.

## Next Steps

- Unblocks Phase 05 (`compare` + `diagnose` follow the same authoring pattern).
- Phase 06 may add LLM-generated session titles using the same skill-loader pattern.

## Unresolved Questions

1. Should slash prefix accept full skill name (`/metric_explain`) or short alias (`/metric`)? Default: both, mapped in a tiny alias table.
2. Should `metric_explain` ever emit a `query_artifact`? Frontmatter currently allows it for the "and show me last week" follow-up; reviewer can drop if too permissive.
