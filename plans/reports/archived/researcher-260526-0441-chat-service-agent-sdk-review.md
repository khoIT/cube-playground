# Agent SDK Review: chat-service/ Architecture & YAML Access Pattern

**Date:** 2026-05-26 | **Scope:** SDK v0.3.150 usage, tool surface, YAML access pattern, enhancement adoption

---

## 1. Snapshot — How chat-service Uses the SDK Today

### SDK Entry Point & Isolation

**File:** `chat-service/src/core/claude-runner.ts` (main SDK harness)

- **Query entry:** `query()` at line 145 with options config (model, systemPrompt, mcpServers, allowedTools, disallowedTools, permissionMode, env)
- **Subprocess isolation:** HOME set to `runtime/claude-home` (line 31) with isolated `.claude/settings.json` containing `hooks: {}` (lines 44–52) — **no global hooks inherited**
- **Prompt caching:** ANTHROPIC_PROMPT_CACHE_ENABLED flag; when disabled, appends per-turn nonce (line 143) to bust cache

### Tools Layer

**File:** `chat-service/src/tools/registry.ts` (13 registered tools)

**In-process MCP server** via `createSdkMcpServer()` (line 123, claude-runner.ts):
```
name: 'cube-playground-tools'
tools: [
  get_cube_meta, disambiguate_query, preview_cube_query,
  emit_query_artifact, list_business_metrics, get_business_metric,
  list_segments, get_segment, explain_cube_sql, emit_chart,
  update_business_metric_trust
]
```
Wrapped via `sdkTool()` at line 111, bound via closure to ToolContext (userId, gameId, db, serverBaseUrl, etc.).

**Allowed tools:** Per-skill whitelist from SKILL.md `allowed_tools:[]` frontmatter; empty list = pass-through all 13.
**Disallowed SDK builtin tools** (line 154): Read, Write, Bash, WebFetch, WebSearch, Edit, MultiEdit — **completely blocked**.

### Prompts Layer

**File:** `chat-service/src/core/mode-prompts.ts`

Composition order (lines 48–81):
1. Master command (`cube-playground.md`, line 18) — cached at module level
2. Active skill body from SKILL.md (lines 65–67) — skill-loader cache with TTL
3. Active game context (line 69)
4. Field chip token guidance (lines 88–100)
5. Optional context preamble (line 74)

**Skills directory:** `chat-service/.claude/skills/` (4 skills found):
- `explore/` — open-ended exploration (get_cube_meta, disambiguate_query, preview_cube_query, emit_query_artifact, emit_chart, etc.)
- `compare/` — comparative analysis
- `metric_explain/` — semantic interpretation
- `diagnose/` — debug & validation

**System prompt wiring:** Composed at turn time; no `systemPrompt: 'preset'` config (not used). Skill-loader is 80-line cache with file existence check (skill-loader.ts:60–79); no hook/setting-source integration.

### File System Access

**YAML metadata → model:**

All metadata flows via **server API endpoints** as HTTP JSON, not direct file access:

- **Business metrics** (list_business_metrics tool):
  - Server reads from `server/src/presets/business-metrics/*.yml` (1144 total lines across ~60 files)
  - Cached in-memory via `business-metrics-loader.ts:loadAll()` at boot
  - Model calls `get_business_metric(id)` → server returns parsed JSON `/api/business-metrics/:id`
  
- **Segments** (list_segments / get_segment tools):
  - Server DB-backed; no YAML read
  - Model calls `get_segment(id)` → server returns `/api/segments/:id` (JSON)

- **Cube metadata** (get_cube_meta tool):
  - Server calls `gds-cube` client → Cube API
  - Returns `/meta` JSON, cached in `cube-meta-cache.ts`

- **Dashboards** (not exposed to model):
  - Server presets in `server/src/presets/dashboard-starter-pack/*.yml`
  - Not invoked by agent; user views them in UI

**Bottom line:** No filesystem Read/Glob/Grep for YAML by the model. All data access is through custom MCP tools that call server endpoints (HTTP JSON), which deserialize YAML server-side.

### Enhancements Adoption

| Enhancement | Status | Evidence |
|---|---|---|
| **Hooks** | ❌ Disabled | Line 44: `hooks: {}` in settings; subprocess has no global hooks |
| **Observability** | ✅ Custom built | `src/observability/sdk-event-extractor.ts` (60 lines) + `composite-observer.ts` for side-channel LLM/tool event wiring; Langfuse tracer integration |
| **Memory** | ✅ Partial | Session-scoped slot memory in `disambiguate_query` (slot-extractor reads/writes session DB via `disambig-memory-adapter.ts`); not cross-session SDK memory |
| **Auto-compaction** | ✅ Manual | `compact-service.ts` (93 lines) — triggers at 80% context budget; creates new session with summary preamble; not SDK auto-compact feature |
| **Web Search** | ❌ No | `WebSearch` in disallowedTools line 154 |
| **Research Mode** | ❌ No | No `research: true` or equivalent in query options |
| **Subagents** | ❌ No | No `agents:[]` config, no delegation pattern |

**Hooks detail:** claude-runner seeds isolated HOME to prevent inherit of global hooks; this is intentional for safety, not feature use.

---

## 2. The YAML Access Question — Direct Answer

### Recommendation: **Hybrid (MCP index + filesystem browse)**

**Current state:** Pure MCP-via-HTTP. All YAML deserialization happens server-side; model sees only JSON tool results.

### Why NOT pure filesystem (Read/Glob):

- **Blocked by design** — Read, Glob, Bash in `disallowedTools` line 154 — would require code change to enable
- **Loses schema control** — if model browses raw YAML, typos / missing fields become model's problem, not validation layer's
- **Context bleed** — 60 business-metric YAMLs × ~20 LOC = 1200 tokens just to browse; per-id fetch via MCP is ~50 tokens per lookup
- **No type safety** — model doesn't know the schema; can misinterpret alias arrays, formula nesting, trust tiers

### Why current MCP is good:

- **Deterministic filtering** — tools return only relevant fields (e.g., `get_business_metric` returns full YAML-derived object including formulas, synonyms, etc.; `list_business_metrics` returns just id/name/trust)
- **Caching** — server in-memory cache (business-metrics-loader.ts:29) means repeated lookups are O(1)
- **Validation at write time** — YAML is Zod-validated on POST /api/business-metrics (business-metrics.ts:52–59)
- **Trust metadata** — business metric trust tier resolved per-game at query time, not static in YAML

### Hybrid pattern (if context budget becomes tight):

1. **Keep:** `list_business_metrics` (returns id, name, trust, updated_at) for scanning
2. **Add:** `list_business_metrics_full` that returns also formula, category, synonyms in one call (avoid repeated get_business_metric calls)
3. **Add:** `search_business_metrics(query)` that does fuzzy matching server-side (cheaper than LLM re-thinking matches)

**This stays MCP-native.** No filesystem read needed.

### YAML count / shape facts:

- ~60 business-metric files, 1144 total lines
- Each ~18 LOC avg; largest ~30 LOC
- Schema: id, formula, category, trust, synonyms, related_concepts, game_compatibility, aliases (see business-metric.ts types)
- Rarely change; watch/reload in dev mode only (business-metrics-loader.ts:57–61)

**Verdict:** MCP is correct. If the model were allowed Read/Glob, it would still call MCP tools for schema validation and context-efficient lookup. Filesystem browse adds no value.

---

## 3. Ranked Improvements (Impact × Effort)

### #1. **Codify Query Options as Exported Config Interface**
- **Impact:** H | **Effort:** S | **Architecture lift:** 2
- **What's wrong:** Query options hardcoded in claude-runner.ts lines 147–161. Adding model, switching permissionMode, or changing disallowedTools requires code edit + deploy.
- **Proposed:** Export `QueryOptionsPreset` enum: `'standard'`, `'research-safe'`, `'custom'`. Let config.ts or env var select. Tested presets.
- **Citation:** claude-runner.ts:145–162 (options object), config.ts:34–70 (no query options config)
- **Risk:** Cosmetic if presets are locked; medium if config allows arbitrary options (permissionMode bypass).

---

### #2. **Expose Optional Web Search & Research Mode Behind Feature Flag**
- **Impact:** H | **Effort:** M | **Architecture lift:** 3
- **What's wrong:** WebSearch completely disallowed (line 154); no research mode. Model can only call 13 tools; no ability to do broad glossary refinement or ambiguity exploration.
- **Proposed:** 
  - Add `CHAT_ENABLE_WEB_SEARCH` env var; if true, remove WebSearch from disallowedTools + add to allowed list
  - Add `CHAT_ENABLE_RESEARCH_MODE` env var; if true, pass `research: true` in query options
  - Feature-flag behind game or skill (e.g., diagnose skill enables research mode)
  - Test: verify model doesn't misbehave with expanded surface
- **Citation:** claude-runner.ts:154 (disallowedTools), missing: research flag in query options (Anthropic SDK v0.3.150 docs)
- **Risk:** Expanded tool surface = more token cost; research mode = higher latency; guard behind skill allowlist.

---

### #3. **Consolidate Observability Hooks into Unified LLM Tracer**
- **Impact:** M | **Effort:** M | **Architecture lift:** 3
- **What's wrong:** Two parallel observability paths: `sdk-event-extractor.ts` (side-channel raw events) + `langfuse-tracer.ts` (downstream traces). Both parse the same SDK messages; risk of drift.
- **Proposed:**
  - Unify into single tracer that consumes SDK events → emits Langfuse spans (cost, tokens, tool latency, errors)
  - Simplify claude-runner observer dispatch (lines 173–213) to single `observer.emit(SdkEvent)` call
  - Add structured logging: `{ turnId, stepIndex, toolName, latencyMs, tokensIn/Out, error }` per tool
  - Test: tracer must emit at least: LLMCall, ToolInvocation, TurnFinalized with all fields
- **Citation:** claude-runner.ts:173–213 (3 observer dispatch sites), observability/sdk-event-extractor.ts (26–206), langfuse-tracer.ts
- **Risk:** Refactor; must not drop signals (test coverage required).

---

### #4. **Add Cross-Turn Memory via SDK Memory Store (Not Yet Implemented)**
- **Impact:** M | **Effort:** L | **Architecture lift:** 2
- **What's wrong:** Session-scoped slot memory exists (disambig-memory-adapter.ts); no longer-lifetime memory across sessions. If user returns after compaction, they lose context.
- **Proposed:**
  - Add optional `memory: { store: 'user-preferences' }` in query options; SDK will persist key-value dicts across turns/sessions
  - Use for: user's preferred metric aliases, favorite time granules, game context (cached, user can reset)
  - Wire into disambiguate_query step: check cross-session memory for `preferred_metric`, `preferred_dimension` before defaulting
  - Test: memory survives compaction; can be cleared via user command
- **Citation:** compact-service.ts (session-level compaction), disambiguate_query tool (uses only session DB), SDK docs (memory store feature in v0.3.150+)
- **Risk:** Low; feature is opt-in and non-breaking.

---

### #5. **Test Coverage for Agent Loop (claude-runner.ts)**
- **Impact:** M | **Effort:** M | **Architecture lift:** 2
- **What's wrong:** No tests for the main run() generator. Observability and permission-mode logic untested. Tool filtering logic (lines 104–107) has no unit test.
- **Proposed:**
  - Add `claude-runner.test.ts` with:
    - Mock query iterator
    - Test allowedToolNames filtering (empty list = all tools; non-empty = subset)
    - Test observer signal firing (onSdkEvent, onLlmCall, onToolInvocation, emitTurnFinalized)
    - Test systemPrompt cache-bust nonce injection
  - Add `skill-loader.test.ts` for cache TTL expiry (already has interface, no test)
  - Target: >80% line coverage of claude-runner + skill-loader
- **Citation:** claude-runner.ts (no .test.ts counterpart; 214 lines), skill-loader.ts:53–79 (cache logic), test count: 237 files in chat-service but none for core/
- **Risk:** Time; won't break code but required for confident refactors later.

---

### #6. **Extract nl-to-query into Deterministic Composable Steps**
- **Impact:** M | **Effort:** M | **Architecture lift:** 2
- **What's wrong:** Slot extraction (1076 LOC across clarification-builder.ts, slot-extractor.ts, synonym-resolver.ts, date-resolver.ts, number-normaliser.ts) is hand-rolled determinism. Model calls disambiguate_query tool; tool runs all 5 steps internally. If any step fails, whole call fails.
- **Proposed:**
  - Expose `get-glossary()` tool (returns list of { id, aliases, cube_ref, category }) — lets model explore synonyms
  - Expose `parse-date-range(text)` tool — lets model confirm "Q1 2026" interpretation
  - Keep disambiguate_query but make it *compose* calls to finer-grained tools
  - Benefit: model can backtrack if date parsing fails; glossary browsing can inform multi-turn clarification
- **Citation:** nl-to-query/index.ts (1076 LOC), disambiguate-query.ts (reads from glossary client, internally calls slot-extractor)
- **Risk:** Adds 2–3 new tool surface; requires testing to ensure model uses them sensibly (doesn't call in wrong order, doesn't miss intent).

---

### #7. **Structured Audit Trail for Business Metric Changes**
- **Impact:** L | **Effort:** S | **Architecture lift:** 1
- **What's wrong:** Business metrics are mutable via POST /api/business-metrics + PATCH /api/business-metrics/:id/trust. No audit log of who changed what when. Model is blindly calling update_business_metric_trust without knowing approval workflow.
- **Proposed:**
  - Add `audit_log` table: (timestamp, user_id, action, metric_id, old_value, new_value, reason)
  - Update trust PATCH route to insert audit row + emit event
  - Expose read-only audit via `get_business_metric_history(id)` tool
  - Test: any trust change is logged; history is immutable
- **Citation:** business-metrics.ts (POST/PATCH routes have no audit), update-business-metric-trust.ts tool
- **Risk:** Schema change; must backfill existing trust changes (or start fresh).

---

### #8. **Streaming + SSE Wiring Clarity**
- **Impact:** L | **Effort:** S | **Architecture lift:** 1
- **What's wrong:** Query options do not include `stream: true`. claude-runner.ts yields SseEvent objects by mapping SDK messages (sse-stream.ts:mapSdkMessage). But SDK-level streaming vs. HTTP streaming is unclear from config.
- **Proposed:**
  - Document or set `stream: true` explicitly in query options (line 147–161)
  - Add comment: "SDK streams messages token-by-token; mapSdkMessage converts to SseEvent for HTTP response."
  - Verify SSE encoding in turn.ts (POST /agent/turn route) matches client expectations
- **Citation:** claude-runner.ts:145 (query call, no stream option), sse-stream.ts (mapSdkMessage function), turn.ts (HTTP handler)
- **Risk:** None if documented; potential confusion if streaming is disabled/non-functional.

---

### #9. **Cancellation & Timeout Handling**
- **Impact:** M | **Effort:** M | **Architecture lift:** 2
- **What's wrong:** Query iterator (claude-runner.ts:145–207) runs to completion. No AbortController or timeout; if model loops infinitely or server is slow, turn hangs.
- **Proposed:**
  - Accept `timeoutMs` in RunParams; wrap iterator with abort signal
  - Emit error SseEvent and clean up if timeout fires
  - Test: verify turn stops gracefully if timeout expires mid-tool-invocation
- **Citation:** claude-runner.ts:97 (RunParams interface), missing timeout field
- **Risk:** Requires SDK API check (does query() accept abort signal in v0.3.150?); non-trivial if not.

---

## 4. Quick Wins (Sub-1-day, Safe Edits)

- **Codify disallowedTools list as constant** (`DISABLED_BUILTIN_TOOLS`). Makes it auditable; safer than line-hardcoded list.
- **Add `.test.ts` for skill-loader** (80 lines). Test TTL expiry with mocked clock. ~30 min.
- **Document field-chip token spec** (mode-prompts.ts:88–100 guidance already exists; add link to schema cartographer in comment).
- **Add env var: ANTHROPIC_PROMPT_CACHE_ENABLED override** (already gated at line 141; expose as config var instead of reading from global config).
- **Validate tool registry** — at boot, ensure every tool in SKILL.md allowed_tools actually exists in registry. Quick grep check; add to health endpoint.

---

## 5. Unresolved Questions

1. **Does SDK v0.3.150 support research mode / web_search natively?** Docs mention it; needs confirmation on exact flag names and behavior.
2. **Does query() accept AbortController for cancellation?** Timeout handling requires this.
3. **Are there cross-session memory stores in SDK v0.3.150, or is that future?** Mentioned in roadmap; if available, we should use it for user preferences.
4. **Should nl-to-query layer be exposed as tools or kept internal?** Currently it's part of disambiguate_query. Exposing finer steps (glossary, date parsing) adds surface but improves debuggability.
5. **What's the compliance/approval workflow for business-metric changes?** model calls update_business_metric_trust with no audit trail. Is this intentional?

---

**Status:** DONE
**Summary:** Chat-service correctly uses Agent SDK v0.3.150 with in-process MCP tools and server-side YAML deserialization. YAML access via MCP is the right pattern; no filesystem read needed. Top 3 improvements: (1) codify query options as presets, (2) expose research mode behind flag, (3) unify observability hooks. All changes are isolated; no breaking refactors required.
