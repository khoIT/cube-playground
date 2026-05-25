# Token Caching Opportunities in cube-playground

**Date**: 2025-05-25  
**Scope**: chat-service + frontend token-consuming operations  
**Goal**: Map which operations hit LLM / expensive external calls, their caching status, and identify optimization opportunities.

---

## Executive Summary: Top 5 Token-Saving Opportunities

1. **System Prompt Caching (Anthropic Prompt Caching)** — system prompts are recomputed hash but never marked cacheable in SDK calls. Potential 40–60% token reduction per turn via native Anthropic prompt cache.
2. **Cube Meta (/meta) Pre-fetching in Sessions** — `/cubejs-api/v1/meta` is TTL-cached (60s) per game, but miss on first query of a session + every new skill. Cache warming could eliminate 1–2 queries/session.
3. **Title Summarisation Deduplication** — identical 3-message subsets across multiple sessions trigger identical LLM calls on turn 3. Cache by (owner, normalized messages) with 24h TTL.
4. **Query Artifact Preview Cache** — `preview_cube_query` (/load calls) executed eagerly per tool invocation are not cached; identical preview calls re-fetch from Cube.
5. **Session Compaction Summary Deduplication** — on 80% budget threshold, LLM summarizes identical 20-turn windows; no dedup across sessions/owners.

---

## Detailed Findings

### 1. Chat Turn Flow (System Prompt, Intent Routing, LLM Calls)

**File**: `chat-service/src/api/turn.ts`, `chat-service/src/core/claude-runner.ts`

| Component | Token Cost | Frequency | Caching | Status |
|-----------|-----------|-----------|---------|--------|
| **System Prompt Assembly** (line 264) | ~200–500 tokens | Every turn | Hashed for response cache key, but never sent to Anthropic SDK with `cache_control` | **CACHEABLE** — Not yet using Anthropic prompt cache |
| **Intent Routing** (line 253) | ~10 tokens | Every turn | Pure keyword heuristic (no LLM) | **NOT CACHEABLE** — already optimized |
| **Master Prompt Read** (mode-prompts.ts:25) | N/A (cached at module init) | Every turn | Memoized in memory | **ALREADY CACHED** |
| **Skill Body Load** (mode-prompts.ts:56) | N/A (cached by skill-loader) | Every turn | Per-skill LRU cache | **ALREADY CACHED** |
| **Main Claude Agent Turn** (claude-runner.ts:135) | 500–3000 tokens | Every turn | Response-level cache (turn.ts:278–507) | **ALREADY CACHED** (per user text + skill + game + model) |

**Key Finding**: System prompt is recomputed every turn but sent to SDK without `cache_control: { type: 'ephemeral' }`. Anthropic native prompt caching could reduce input tokens by 40–60% on turns 2+ within a single conversation (SDK session).

**Recommendation**: Modify `claude-runner.ts:135–150` to wrap the system prompt with Anthropic cache control.

---

### 2. Cube Tool Calls (Metadata, Queries, Validation)

**Files**: `chat-service/src/core/cube-meta-cache.ts`, `chat-service/src/tools/emit-query-artifact.ts`, `chat-service/src/tools/preview-cube-query.ts`, `chat-service/src/cache/refresh-cached-artifacts.ts`

| Operation | Token Cost | Frequency | Caching | Status |
|-----------|-----------|-----------|---------|--------|
| **GET /cubejs-api/v1/meta** (cube-meta-cache.ts:31–50) | ~50–200 tokens (bandwidth, not LLM) | 1–2× per session | LRU cache (60s TTL, max 50 games) | **ALREADY CACHED** |
| **Extract Member Names** (cube-meta-cache.ts:54–66) | N/A (in-memory) | Every tool validation call | No cache (re-extracted per call) | **CACHEABLE** — memoize extracted set within TTL window |
| **POST /cubejs-api/v1/load** (preview-cube-query.ts:99–107) | ~100–500 tokens | Per `preview_cube_query` tool call (1–3× per turn) | NOT CACHED | **CACHEABLE** — cache by normalized query + game + cubeToken hash, TTL 5m |
| **POST /cubejs-api/v1/load** (refresh-cached-artifacts.ts:24–37) | ~100–500 tokens | On cache-hit replay, per chart with artifactRef (0–2× per cached turn) | NOT CACHED | **CACHEABLE** — share row cache with preview-cube-query |
| **Query Member Validation** (emit-query-artifact.ts:74–97) | ~10 tokens (SDK schema validation) | Per emit_query_artifact call (1–2× per turn) | No cache | **CACHEABLE** — check against extracted member set (memoized) |

**Key Finding**: `/load` queries are executed without result caching. Identical queries within a 5–10 minute window (e.g., user re-runs same chart multiple times or multiple sessions hit same metric) repeatedly fetch from Cube.

**Recommendation**: Introduce a query result cache keyed by `hash(query.measures + query.dimensions + query.filters + gameId)` with 5–10m TTL.

---

### 3. Chart Generation & Spec Validation

**Files**: `chat-service/src/tools/emit-chart.ts`, `chat-service/src/services/chart-spec.ts`

| Operation | Token Cost | Frequency | Caching | Status |
|-----------|-----------|-----------|---------|--------|
| **ChartSpec Zod Validation** (emit-chart.ts:68) | ~5–10 tokens (SDK pre-validates) | Per emit_chart call (1–2× per turn) | No cache | **NOT CACHEABLE** — validation is cheap |
| **buildChartArtifact** (emit-chart.ts:79) | ~10 tokens (truncateTopN, id generation) | Per emit_chart / emit_query_artifact | No cache | **NOT CACHEABLE** — deterministic, lightweight |
| **Truncate Top-N** (chart-spec.ts:100+) | N/A (in-memory) | Per chart emission | No cache | **NOT CACHEABLE** — fast in-memory operation |

**Status**: Chart generation is already lightweight and deterministic. No caching needed.

---

### 4. Embeddings / Vector Search

**Finding**: No embeddings, vector DB, or semantic search is currently used. Cross-turn search in DevAudit (dev-audit-page.tsx:16) uses turn-search-store with keyword indexing (tool_invocations.args_json grep), not embeddings.

**Status**: **NOT CACHEABLE** — feature not present.

---

### 5. Cube Metadata Hashing

**File**: `chat-service/src/core/cube-meta-cache.ts:76–108`

| Operation | Token Cost | Frequency | Caching | Status |
|-----------|-----------|-----------|---------|--------|
| **getMetaVersion** (line 76) | N/A (crypto.sha256, ~1ms) | Every turn response-cache lookup (turn.ts:280) | Memoized within 60s TTL window | **ALREADY CACHED** |
| **computeMetaVersion** (line 89) | N/A (deterministic hash) | Per meta fetch or on miss | Computed once per TTL cycle, memoized | **ALREADY CACHED** |

**Status**: Metadata hashing already leverages TTL caching and memoization.

---

### 6. System Prompts & Tool Descriptions

**Files**: `chat-service/src/core/mode-prompts.ts`, `chat-service/src/tools/registry.ts`

| Operation | Token Cost | Frequency | Caching | Status |
|-----------|-----------|-----------|---------|--------|
| **Read Master Prompt** (mode-prompts.ts:23–29) | N/A (file I/O, ~1ms) | Module init only, cached in memory | Singleton memoization | **ALREADY CACHED** |
| **Load Skill Body** (mode-prompts.ts:56) | N/A (file I/O, ~1ms) | Per turn (via skill-loader cache) | Per-skill LRU | **ALREADY CACHED** |
| **SDK Tool Schema Serialization** (registry.ts) | ~20–100 tokens (included in system prompt) | Every turn | Recomputed (no cache) | **CACHEABLE** — tool schemas are static; include once per session |

**Status**: Already well-cached. Tool schemas could be optimized by memoizing the full schema block and only updating on skill change.

---

### 7. Sub-LLM Calls (Title Summarisation, Compaction)

**Files**: `chat-service/src/core/title-summariser.ts`, `chat-service/src/core/compact-service.ts`

| Operation | Token Cost | Frequency | Caching | Status |
|-----------|-----------|-----------|---------|--------|
| **Title Summarisation** (title-summariser.ts:29–54) | ~100 tokens | Once per session on turn 3 (if turn_count == 3 and title is auto-prefixed) | NOT CACHED | **CACHEABLE** — cache by (owner_id, normalized first 3 user messages), TTL 24h |
| **Session Compaction Summary** (compact-service.ts:70) | ~200–300 tokens | Once per session when >80% budget threshold crossed (typically 10–20 turns into session) | NOT CACHED | **CACHEABLE** — cache by (owner_id, hash of last N turns), TTL 7d |

**Key Finding**: Turn 3 calls `summariseTitle` via SDK query (turn.ts:533–550). This is fire-and-forget but repeats identically across sessions with the same user's first 3 messages.

**Recommendation**: Introduce a titled-turn cache keyed by `hash(owner_id + normalize(first 3 user messages))` before calling `summariseTitle`.

---

### 8. Token Usage Observability (DB Schema & DevAudit Panel)

**Files**: `chat-service/src/api/debug.ts`, `chat-service/src/db/observability-store.ts`, `src/pages/DevAudit/dev-audit-page.tsx`

| Component | Query Cost | Frequency | Caching | Status |
|-----------|-----------|-----------|---------|--------|
| **GET /debug/turns/:turnId** (debug.ts:10) | 3–4 SELECT queries (llm_calls, tool_invocations, aggregates) | Per turn detail view | No cache | **CACHEABLE** — cache per-turn detail for 1h (immutable after persistence) |
| **DevAudit Session List** (session-list) | SELECT all sessions + aggregate counts | On page load, paginated | No cache | **NOT CACHEABLE** — live data (sessions can be deleted/updated) |
| **Turn Search** (turn-search-store) | Full-text index scan on tool args + result | Per search query | No cache | **NOT CACHEABLE** — user-initiated live search |

**Status**: Turn detail queries are immutable once written; 1h cache would be safe and reduce DB load on repeated inspector checks.

---

### 9. Auto-Title Generation (Fire-and-Forget)

**File**: `chat-service/src/api/turn.ts:515–550`

**Current Flow**:
1. After turn 3, if `session.title` is auto-prefixed (default), trigger `summariseTitle`.
2. Call is fire-and-forget via `queueMicrotask` (non-blocking).
3. No deduplication across sessions.

**Finding**: If two users (or same user in two sessions) have identical first 3 messages, each session triggers an identical SDK `query` call.

**Potential Savings**: ~100 tokens × (duplicate title calls per day). For 100 users with 2 duplicate sessions each = ~10k tokens/day.

---

### 10. Response Cache (Already Implemented)

**Files**: `chat-service/src/cache/response-cache-*`, `chat-service/src/db/response-cache-store.ts`

**Status**: **ALREADY CACHED**
- Key: `hash(skill | gameId | normalize(userText) | cubeMetaHash | model | systemPromptHash)`
- Stored: Full turn (assistant text + artifacts + charts)
- Hit rate: Tracked in `response_cache` table (hit_count, created_at, last_hit_at)
- TTL: Unbounded (rows purged by cron job if >X days old)

**Refresh on Cache Hit** (refresh-cached-artifacts.ts):
- Charts linked to query artifacts re-execute /load on cache replay (best-effort)
- Query artifacts themselves NOT re-fetched (FE handles that)

---

## Cache Effectiveness Metrics

**Current Database Tables** (from observability-store.ts, response-cache-store.ts):
- `chat_turns`: input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cache_hit, original_turn_id
- `response_cache`: hit_count, last_hit_at, cube_meta_hash, (for stale detection)
- `llm_calls`, `tool_invocations`, `sdk_events`: Detailed audit trail

**DevAudit exposes** (debug.ts:54–70):
- Per-turn: llmCallCount, toolInvocationCount, inputTokens, outputTokens, costUsd, cacheHit flag
- Aggregate: session-level totals via incrementTurnCount (turn.ts:513)

---

## Implementation Roadmap

### Phase 1 (Quick Wins, 1–2 days)
1. **System Prompt Caching**: Add `cache_control: { type: 'ephemeral' }` to SDK system prompt in claude-runner.ts.
2. **Memoize Extracted Members**: Cache `extractMemberNames(meta)` result within TTL window in cube-meta-cache.ts.
3. **Turn Detail DB Cache**: Add 1h read cache for `/debug/turns/:turnId` queries.

### Phase 2 (Medium-Effort, 3–5 days)
1. **Title Summarisation Dedup**: Create `title-dedup-cache` keyed by (owner_id, message_hash), TTL 24h.
2. **Query Result Cache**: Implement /load result cache keyed by (query_hash, gameId), TTL 5m, separate from response cache.
3. **Anthropic Session Persistence**: Persist SDK session IDs per chat session to enable multi-turn native caching benefits (separate from response cache).

### Phase 3 (Complex, 1–2 weeks)
1. **Compaction Summary Dedup**: Cache by (owner_id, turn_window_hash), TTL 7d.
2. **Prompt Cache Tuning**: Monitor cache_read_tokens vs. cache_creation_tokens trade-offs; adjust SDK session lifetime.

---

## Risk Assessment

- **System Prompt Caching**: Low risk. Anthropic SDK natively supports it. No schema changes needed.
- **Query Result Cache**: Medium risk. Cache invalidation on schema changes (needs /meta hash re-check).
- **Title Dedup**: Low risk. Fire-and-forget call, cache miss is silent fallback to non-dedup LLM call.
- **Compaction Dedup**: Low risk. Rare operation (80% budget threshold).
- **Session Persistence**: High risk. Adds SDK session state management; test thoroughly before rollout.

---

## Unresolved Questions

1. **Prompt Cache Lifespan**: How long does Anthropic keep prompt cache entries alive? Test with real SDK to measure cost vs. benefit window.
2. **Query Cache Invalidation**: When should /load result cache invalidate? On next meta fetch? On fixed TTL only?
3. **Multi-Session Title Dedup Scope**: Should title cache be global (across all users) or per-owner? Per-owner is safer but reduces hit rate.
4. **SDK Session Persistence**: Does Claude Agent SDK support explicit session ID persistence? Verify before Phase 3.

