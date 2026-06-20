# Decouple Chat Service from Advisor & Care Engine

**Date**: 2026-06-20 13:15 GMT+7  
**Severity**: High  
**Component**: Chat service, diagnostic rail, advisor integration  
**Status**: Resolved

## What Happened

Decoupled `chat-service` from the server-side advisor lens/recommend engine and "care" system concepts, making chat a self-contained expert game-liveops analyst. Chat lost 3 tools (`recommend_actions`, `decompose_metric`, `care_queue`) + 2 private helpers + 3 tests. In exchange, rewrote `advise` and `diagnose` skill prompts to bake the diagnostic depth directly into the agent's reasoning loop: genre-informed hypothesis → query confirmation via real `preview_cube_query` data → conclusions anchored to `get_metric_benchmark` / `get_topic_knowledge`.

Kept `get_metric_benchmark` (hits the benchmark library directly, not the lens) and the segments / query builder toolset intact. Verified: `tsc --noEmit` clean; chat suite 1289 pass / 2 pre-existing snapshot failures (no new regressions).

## The Brutal Truth

This decoupling was a deliberate refactor, not a downgrade. The reason it works: the model-as-expert pattern (role as a senior liveops practitioner + business leader at a ~$300M publisher) is stronger than the engine's citation trails when grounded by real Cube data queries. The decision _feels_ risky because we lost the engine's ability to say "no, reject that without proof" — but that gate was mechanical (list of safe decompositions) not semantic (understanding). The new risk is ungrounded hallucination. Mitigation: hard rules in the skill prompts (query-before-claim, mandatory benchmark anchor, genre-honesty guardrails like "can't assess — no data path").

The standalone Advisor FE console (`/pages/Advisor/…` → `/api/advisor/…`) was _untouched_. It calls the server's recommend engine directly and ships independently. CS care dashboard same story. So the engine still exists — it's just not in the chat loop anymore.

## Technical Details

**Removed from `chat-service/src/tools/registry.ts`:**
- `recommend_actions` (engine consumed as JSON, reformatted for chat output)
- `decompose_metric` (engine lens → metric SQL decomposition)
- `care_queue` (pre-fetched CS queue state + intent routing)
- Private helpers: `recommendation-citation`, `recommendation-trust-guard`
- 3 tests covering the above

**Skill rewrites:**
- `chat-service/.claude/skills/advise/SKILL.md`: Genre loop now runs _inside_ the agent. Hypothesis → `preview_cube_query` (hit Cube live) → `get_metric_benchmark` (pull baseline anchors) → conclusion. Persona contract locked (senior liveops + business leader, ~$300M publisher). Honesty guardrails: explicit "cannot assess" when no data path exists.
- `chat-service/.claude/skills/diagnose/SKILL.md`: Same pattern. Root-cause hypotheses confirmed by real queries, not engine decomposition. Benchmark anchoring mandatory.

**Kept intact:**
- `get_metric_benchmark` (direct benchmark library hit; removed stale `decompose_metric` doc refs)
- Full segments toolset
- Query builder
- `preview_cube_query`, `get_topic_knowledge` as grounding anchors

**Scope note added:** `docs/lessons-learned.md` under "Advisor & Diagnostic Rail" clarifies: chat is now self-contained, but the server Advisor engine + FE console (`/pages/Advisor/*`) + CS care dashboard still run independently with full engine access.

## What We Tried

Single approach: move the expertise from engine citation to agent skill grounding. The plan at `plans/260620-1112-decouple-chat-service-from-advisor-and-care/` locked this strategy early because the gap was architectural (chat had a hard dependency on engine internals; care routing was brittle). Parallel approach (keep both systems) rejected due to maintenance cost: the engine and chat had conflicting evolution pressures (engine wants pre-computed safe decompositions; chat wants flexible reasoning).

## Root Cause Analysis

The advisor engine and chat had diverged in purpose: the engine optimized for "safe, audited, cited claims" (good for an automated recommendation UI with legal exposure), while chat needed "fast, flexible, grounded reasoning" (good for interactive exploration). The overlap created a confusing split: chat would cite the engine's decomposition but then discard its output and reason independently anyway. The engine's output was either ignored or reformatted to fit chat's genre contract. This is wasted infrastructure.

Chat's real constraint isn't "trust the engine's math," it's "query before you claim." That's achievable via skill guardrails without the engine at all.

## Lessons Learned

1. **Model-as-expert beats engine-as-gatekeeper when grounded by real queries.** The Advisor engine works for recommendation UIs because the UI can't query (no browser → Cube). Chat can query. Shift the gate from "did the engine approve?" to "did you verify with a query?"

2. **Hard grounding rules in skill prompts scale better than architecture.** "Query before claim" + "mandatory benchmark anchor" + "explicit honesty about gaps" in plain English in the prompt outperforms a symbolic engine trying to enumerate safe outputs. The agent model can reason about these constraints; the engine cannot.

3. **Better-sqlite3 ABI skew is real and loud.** When 388 tests fail at `new Database()` with identical `NODE_MODULE_VERSION` errors, it's not code — it's a concurrent rebuild for the wrong Node version. The signal is unmistakable once you know what to grep for. Lesson for CI: native modules need a rebuild gate post-dependency-install.

4. **Test snapshots in shared repos accumulate stale baselines.** The 2 failing snapshot tests (`mode-prompts.snapshot` from commit d9e3a945) were pre-existing. They're noise. Future: enforce snapshot baselines in CI or delete them if they're not part of a deterministic verification step.

5. **Decoupling ≠ downgrade when constraints shift.** Chat doesn't need the engine's citation trails because chat has a grounding constraint the engine doesn't: "your claim must be queryable." This is a _stricter_ gate.

## Next Steps

1. **Monitor chat's benchmark accuracy** in production (already instrumented via `get_metric_benchmark` calls). If benchmarks drift or are missing for a metric, chat's honesty guardrails will surface it ("can't assess").

2. **FE Advisor console remains live** and calls the server engine directly. No action needed; it's unaffected. If the UI ever needs refactor, it will be independent of this chat change.

3. **CS care dashboard same.** Independent server calls. No blocker.

4. **Segment creation in chat** (deferred per existing memory, see `docs/journals/`) remains unaffected. Segments tool was kept; this change only removed the recommend+decompose+care-queue tools.

Commit 6fc13112 SHIPPED. Plan at `plans/260620-1112-decouple-chat-service-from-advisor-and-care/` moved to DONE.
