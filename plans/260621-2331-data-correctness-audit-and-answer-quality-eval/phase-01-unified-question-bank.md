# Phase 01 — Unified question bank (asked + likely-to-be-asked)

**Priority:** P0 (feeds both other phases) · **Status:** 📋 planned

## Overview

Build a per-game corpus of NL analyst questions from two sources, in the existing `metric-resolution-eval` corpus schema so Phase 03 can consume it directly. Each entry carries `expectedRef`/`expectedCube`/`expectedMetricId`/`queryShapeClass` (the golden answer) plus provenance (`source: asked|synthesized`) and a `weight` (frequency for asked, 1 for synthesized).

## Key insight

Logs alone test what users *happen* to ask. The measures with the worst silent-wrong-number risk are often **under-queried** (no one notices). Synthesizing from the metric catalog forces coverage of every exposed measure regardless of traffic — and the synthesized golden answers are deterministic (derived from the YAML), so they double as Phase 02 audit targets.

## Source A — "Asked" (mined)

- **Chat:** `chat-service/runtime/chat.db`, rows `role='user'`, column `user_text`. Filter out system/service-restart markers.
- **Advisor:** advisor runs persisted to `server/data/segments.db` (migration 055/056) — extract the seed question per run.
- Normalize (lowercase, strip dates), cluster near-duplicates, count frequency → `weight`. Carry game scope from session/run game_id.
- Golden answer for asked questions is **not** hand-known → resolve by one-time chat run + manual spot-confirm for the top-N, leave lower-frequency as `expectedRef: null` (eval scores them for non-empty/answered only, not exact-ref).

## Source B — "Likely-to-be-asked" (synthesized)

- Input: `cube-dev/cube/model/cubes/{game}/game_key_metrics.yml` (+ any `*metric*.yml`) → enumerate every exposed metric → its canonical `cube.measure` ref.
- For each metric, emit a small question set across shape classes: `trend` ("show {metric} last 7 days"), `aggregate` ("{metric} this month"), `compare` ("{metric} this week vs last"), `breakdown` ("{metric} by {top dim}"). Both `en` + `vi` for the high-weight metrics.
- Golden answer = the YAML ref (deterministic). `source: synthesized`, `weight: 1`.

## Related code files

- **Create:** `chat-service/test/eval/question-bank-builder.ts` (mines A, synthesizes B, writes per-game corpus JSON).
- **Create:** `chat-service/test/eval/corpus/{game}-question-bank.json` (output, one per game).
- **Read for schema:** `chat-service/test/metric-resolution-eval/cfm-vn-eval-corpus.json`, `types.ts`.
- **Read for catalog:** `cube-dev/cube/model/cubes/{game}/game_key_metrics.yml`.

## Implementation steps

1. Define corpus entry type extending the existing `types.ts` corpus shape (+ `source`, `weight`).
2. Asked miner: read `chat.db` + `segments.db` (read-only), normalize+cluster+frequency-rank.
3. Synthesizer: parse `game_key_metrics.yml` per game → expand templates × shape × locale.
4. Merge, dedupe (asked question matching a synthesized one keeps the higher weight), write per-game JSON.
5. Seed all 8 games; keep cfm_vn aligned with the existing frozen baseline corpus (don't break it).

## Success criteria

- Per-game `{game}-question-bank.json` exists for all modeled games.
- Every exposed measure in each game's catalog has ≥1 synthesized question (coverage assertion test).
- Asked questions ranked by frequency; top-N have confirmed golden refs.
- Re-runnable (`npm run eval:build-bank`), deterministic for the synthesized half.

## Risks

- `chat.db`/`segments.db` are live + concurrently written → open **read-only**, copy to scratchpad if needed; never lock.
- Synthesized questions may not match current NL phrasing chat expects → keep templates close to the cfm_vn baseline's proven phrasings.

## Unresolved questions

- Q1: For asked questions with no known golden ref, score only non-empty/answered, or attempt auto-label from the first clean run? (lean: auto-label top-N, leave tail unlabeled.)
- Q2: Include `cube-cloud-model` cfm_vn/jus_vn catalogs, or only `cube-dev`? (affects coverage denominator.)
