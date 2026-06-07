# Phase 04 — Prompt text, docs, end-to-end verification

## Context links

- Depends on: phases 01–03.
- `.claude/commands/cube-playground.md` — master command injected into every
  system prompt (contains the clarify HARD STOP rule).
- `src/tools/disambiguate-query.ts` — tool `description` export.
- `../docs/lessons-learned.md` (cube-playground root) — bug-shape registry.
- Dev stack: `npm run dev` (chat-service on :3005, FE on :3000).

## Overview

Priority P2. Make the new behavior legible to the LLM and to future
debuggers, then prove the original conversation now works live.

## Implementation steps

1. **Master command prompt** (`.claude/commands/cube-playground.md`):
   - Keep the HARD STOP rule verbatim (it's correct — the fix is upstream).
   - Add one bullet under the disambiguate section: when the result carries
     an `additive merge:` warning, emit ONE artifact whose query contains all
     measures (both series on the same chart) and mention the merge in the
     narrative; when it carries `…emitted standalone query`, explain to the
     user why the new metric is a separate chart.
   - Document the assumption footer already covers anchored fills (no new
     instruction needed — verify the existing "interpreted X as Y" path
     renders for slot 'metric').
2. **Tool description** (`disambiguate-query.ts`): append one sentence —
   additive follow-ups ("add in X", "thêm X") are handled internally and may
   return a merged multi-measure query.
3. **Docs**:
   - `../docs/lessons-learned.md` entry: *starter pass-through early-return
     skipped session-memory writes → context-blind follow-ups; signal:
     clarify menu unrelated to the on-screen chart; check
     `disambig_resolution` kv row exists after chip turns.*
   - chat-service docs if a disambiguation architecture doc exists (check
     `docs/` for nl-to-query/disambiguation pages; update member-flow
     diagrams only if already documented — no new doc files otherwise).
4. **Full test pass**: `npm test` in chat-service — zero new failures.
5. **Live replay on dev** (:3000, game cfm_vn):
   - New chat → click starter chip "Matches played per day — last 30 days".
   - Send "add in user count per day".
   - Expect: no clarify menu; one chart with matches + distinct players
     series; disclosure footer naming Distinct Players.
   - Inspect `runtime/chat.db`: `disambig_resolution` row carries
     metric + lastQuery after turn 1; turn 2 tool invocation shows
     `action:'auto'` with merged measures.
6. **Negative replay**: send a fresh unrelated long question
   ("currency outflow reasons last week") in the same session — must NOT be
   anchored to etl_game_detail.

## Related code files

- Modify: `.claude/commands/cube-playground.md`
- Modify: `src/tools/disambiguate-query.ts` (description only)
- Modify: `../docs/lessons-learned.md`

## Todo

- [x] Prompt bullet for additive-merge / standalone-split handling
- [x] Tool description sentence
- [x] lessons-learned entry
- [x] `npm test` green (1109 chat-service + 117 FE Chat)
- [ ] Live replay positive case (chip → additive)
- [ ] Live replay negative case (topic pivot not hijacked)

## Success criteria

Original failing conversation works live; full suite green; lessons-learned
captures the bug shape with its signal.

## Risk

- Prompt edits affect EVERY skill (master command is shared) — keep additions
  to ≤4 lines, no restructuring of existing rules.
- `chat-snapshot.json` seed is mid-edit per git status — do not touch seed
  files in this plan.
