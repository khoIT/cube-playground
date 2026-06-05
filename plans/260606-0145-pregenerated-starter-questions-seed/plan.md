# Pregenerated per-game starter questions — frozen seed, identical on prod

**Status:** done · **Branch:** `main` · Seed version `260605-6295` (6 games, ptg skipped-sparse)

## Problem

Starter questions are regenerated per environment: template baseline + async LLM
refine, invalidated whenever `meta_hash` changes. Prod runs its own LLM pass →
different questions from local, and they drift over time. User wants the sets
pregenerated ONCE (this session), persisted, and byte-identical on prod.
Generation must respect data shapes AND actual time coverage (a question like
"this month" is unanswerable when the cube's data ends in April).

## Architecture (mirrors chat-snapshot seed precedent)

```
npm run starters:pregenerate                    boot / request time
  per game (games-readiness):                     starter-question-service
    getMeta → buildTemplateQuestions              ├─ seed registry hit?
    probe time coverage (get_time_coverage         │    upsert row source='seed'
      walk, time dims of baseline cubes)           │    serve verbatim, NO refine,
    refine prompt + coverage section               │    NO meta_hash invalidation
    LLM (sync) → parseAndValidateLlmSet            └─ miss → dynamic pipeline
    → runtime/seed/starter-questions-seed.json         (unchanged)
    → upsert DB row (source='seed')
```

- Seed keyed by `game_id` (workspace-agnostic — business questions don't depend
  on cube layout; `targetCatalogIds` are provenance metadata, not resolved by FE).
- DB row source `'seed'`; HTTP response maps it to `source:'llm'` → zero FE change.
- Seed file checked into git → deploy ships it → prod hydrates the same rows.

## Phases

| Phase | Title | Status |
|-------|-------|--------|
| 01 | Seed loader + service short-circuit + source 'seed' | done |
| 02 | Pregenerate script (coverage probes + sync refine) | done |
| 03 | Run for all games, commit seed, verify endpoint | done |

## Files

- NEW `chat-service/src/db/starter-questions-seed.ts` — seed file load/parse/lookup
- NEW `chat-service/src/scripts/pregenerate-starter-questions.ts` — CLI
- MOD `chat-service/src/db/starter-questions-store.ts` — allow source/status 'seed'
- MOD `chat-service/src/core/starter-question-service.ts` — seed short-circuit
- NEW `chat-service/runtime/seed/starter-questions-seed.json` — generated artifact
- tests: seed loader + service seed-path

## Decisions

- Regenerate fresh (with coverage context) rather than freeze current DB sets —
  matches "based on the data shapes and time range"; the freeze comes from the file.
- Seeded sets never regenerate until the seed file itself changes (version field);
  updating questions = rerun script + commit.
- Games whose schema is too sparse (< 3 template questions, e.g. ptg) are skipped —
  FE static library covers them, same as today.

## Open questions

- None blocking. Prod prefix-named cubes mean seed `targetCatalogIds` use local
  bare names; acceptable because nothing resolves them at serve time (CI test
  only guards the FE static library).
