# Chat-Service Agent Workflow Trace

## Overview

The chat-service implements a **single-turn Claude-with-tools loop** powered by Anthropic's Claude Agent SDK. A user message enters via HTTP POST `/agent/turn`, triggers the orchestrator in `api/turn.ts`, spawns a subprocess running the Claude SDK with an in-process MCP tool server, and streams back SSE events. Tools emit artifacts (queries, charts) via side-channel EventEmitter; the turn handler persists them to the database and writes them to the SSE stream. The **nl-to-query engine** runs INSIDE the `disambiguate_query` tool, not before it — so the agent decides when to resolve natural-language slots into Cube queries.

---

## One Chat Turn: Flow Diagram

```
1. FE POST /agent/turn
   └─ Body: { session_id, owner_id, game, message, context, mode }
   
2. api/turn.ts — validate headers (X-Cube-Token, X-Owner-Id, X-Cube-Game, X-Cube-Workspace)
   └─ Acquire per-session mutex (409 if held)
   
3. Create session if needed; register turn on stream-registry (ring buffer)
   
4. Compose system prompt
   └─ routeIntent(message) → skill name + confidence [from intent-router]
   └─ compose({ skill, game, context, focus }) → systemPrompt + allowedToolNames
   
5. Emit SSE loading event
   
6. Initialize Langfuse/LlmTraceRecorder observers (non-fatal if missing)
   
7. Call claudeRunner.run({
       sessionId, turnId, systemPrompt, allowedToolNames, message, tools, toolContext,
       observer, tracer, resumeId, signal, webSearchEnabled
     })
   ├─ (Inside subprocess via Anthropic SDK)
   ├─ Bind ToolContext into all tool handlers via closure
   ├─ createSdkMcpServer({ name: 'cube-playground-tools', tools: [...] })
   ├─ query({ prompt: message, options }) — iterate as SDK streams messages
   │
   ├─ Per message:
   │  ├─ Capture SDK session id (if exposed on first msg or result msg)
   │  ├─ mapSdkMessage(msg) → SseEvent array (token, tool_use, tool_result, etc.)
   │  ├─ Emit for observer (raw SDK event firehose)
   │  └─ Yield SseEvent items
   │
   └─ For each event: Accumulate tokens, capture thinking, collect artifacts
   
8. Handler collects query_artifact and chart events via sseEmitter listener
   └─ artifact → persist to collectedArtifacts array
   └─ emit({ type: 'query_artifact', data: artifact }) → SSE wire
   
9. Persist assistant turn with artifacts + charts
   └─ chatStore.appendTurn({ id: turnId, artifacts: [...], charts: [...] })
   
10. Persist disambig slots to session-focus bag (if enabled)
    └─ mergeFocus(db, sessionId, { metric, dimension, timeRange, artifactRef, ... })
    
11. Write response-cache entry (if eligible: stop_reason='end_turn', not error)
    
12. Emit done event; close SSE stream
```

---

## Agent Loop Architecture

**Single-LLM-with-tool-use loop** (Anthropic SDK style):
- **LLM core:** One Claude model instance per turn.
- **Tool invocation:** LLM calls named tools; SDK routes each call to the MCP handler.
- **Tool results:** Returned to the SDK; LLM reads + continues.
- **Iteration:** No external orchestrator loop — SDK handles tool_use → tool_result ↔ assistant cycles.
- **Termination:** SDK yields a `result` message when LLM reaches `stop_reason='end_turn'` (or error, stop_sequence, etc.).

**Key property:** No explicit planning or staging. The LLM directly calls tools in whatever order it needs; the `disambiguate_query` tool itself contains the nl-to-query engine, so slot resolution happens on-demand, not upfront.

---

## `nl-to-query/` Pipeline

**Order of operations inside `disambiguate()` at `/nl-to-query/index.ts:51`:**

1. **Language detection** (`detectLanguage(message)`) → `'en' | 'vi'`
2. **Glossary fetch** (`fetchOfficialGlossary()`) → cached official terms + aliases
3. **Slot extraction** (`extractSlots({ message, glossary, knownMembers, now })`) → metric / dimension / filters / intent / timeRange / concept / entity with confidence scores
4. **Query composition** (`composeQuery({ slots, knownMembers })`) → Cube query JSON
5. **Confidence aggregation** (`overallConfidence(slots)`) → 0–1 score
6. **Clarification building** (`buildClarifications({ slots, glossary, threshold })`) → array of bilingual questions
7. **Mode gate** (`modeGate({ mode, overallConfidence, clarifications, threshold })`) → action = `'auto' | 'clarify'`

**Key:** The engine contains **zero LLM calls**. It's pure heuristic + glossary + regex. The LLM never enters this pipeline; it consumes the engine's output and decides whether to ask the user or proceed.

---

## Tool Registry

| Tool Name | Purpose |
|-----------|---------|
| `get_cube_meta` | Fetch `/meta` schema for the game; validate members exist |
| `disambiguate_query` | NL→Cube translation; calls nl-to-query engine + memory bridge + /meta validation |
| `preview_cube_query` | Execute a Cube query; return raw result rows + metadata (for preview, not viz) |
| `emit_query_artifact` | Validate query members, build deeplink URL, emit SSE `query_artifact` event, optionally embed chart |
| `list_business_metrics` | Return all metrics in the catalog (filterable by game) |
| `get_business_metric` | Return one metric's definition + formula + history |
| `list_segments` | Return all segment definitions (filterable) |
| `get_segment` | Return one segment's membership query + metadata |
| `explain_cube_sql` | Return the SQL Cube generates for a given query (for transparency) |
| `emit_chart` | Build inline chart from tabular data; emit SSE `chart` event |
| `update_business_metric_trust` | Record user feedback on a metric's trustworthiness (for ML ranking) |
| `get_business_metric_history` | Return historical metric definitions (for diffs / lineage) |
| `parse_date_range` | (Phase 07, decomposed nl-to-query) Parse relative dates ("last 3 days") into explicit tuples |

**Tool availability:** Determined by `allowedToolNames` in the system prompt (per skill). Tools are bound to the current `ToolContext` via closure in `buildSdkTools()`, so each tool has access to `{ ownerId, gameId, sessionId, turnId, sseEmitter, db, workspace, ... }`.

**How LLM calls tools:** Not user-facing; the SDK intercepts tool_use messages and routes them to handlers. LLM never constructs deeplinks or emits events directly — it calls `emit_query_artifact` with `query + title + summary`; the tool validates + builds URL + emits.

---

## Artifact Creation & Persistence

### Query Artifacts

**`emit_query_artifact` (tool):**

1. Validate measures/dimensions/timeDimensions against `/meta` (fail → return error to LLM)
2. Normalize relative date ranges ("last 3 months" → explicit start/end tuple)
3. Build deeplink URL via `buildChatDeeplink(normalizedQuery)` → includes UUID for sessionStorage fallback
4. Optionally build embedded chart from `args.chart` spec (non-fatal if fails)
5. Emit SSE event via `ctx.sseEmitter.emit('query_artifact', artifact)`
6. Return `{ ok: true, id, deeplinkUrl }` to LLM

**Shape:** `QueryArtifact` =
```ts
{
  id: string;                    // UUID for deeplinkUrl param
  title: string;
  summary: string;
  game: string;
  query: CubeQuery;              // Validated, normalized
  source: 'business-metric' | 'segment' | 'raw';
  sourceRef?: { id, name };      // Catalog metadata
  deeplinkUrl: string;           // FE navigates here; contains ?query=...
  deeplinkVia: 'url' | 'storage';
  payload?: Record<string, any>; // Fallback payload for session storage
  chart?: ChartArtifact;         // Optional inline viz
}
```

**Persistence:** Collected in `api/turn.ts` → `collectedArtifacts` array → persisted in `chatStore.appendTurn({ artifacts: [...] })`

### Chart Artifacts

**`emit_chart` (tool):**

1. Validate ChartSpec (bar, line, pie, scatter, funnel, etc.)
2. Apply top-N truncation; preserve value sum in "Other" lump (if applicable)
3. Build chart object via `buildChartArtifact(spec, { artifactRef })`
4. Emit SSE event via `ctx.sseEmitter.emit('chart', artifact)`
5. Return `{ ok: true, id, truncated }`

**Shape:** `ChartArtifact` =
```ts
{
  id: string;
  type: 'bar' | 'line' | 'pie' | ... ;
  encoding: { x?, y?, series?, category, value };
  data: Array<Record<string, any>>;
  title?: string;
  truncated: boolean;
  artifactRef?: string; // Links to query_artifact.id if part of same analysis
}
```

**Persistence:** Same as query artifacts — collected in `collectedCharts` → appended to turn row.

---

## Disambiguation Flow

**When does the agent pause & ask?**

`disambiguate_query` returns `action='clarify'` when:
- Overall confidence < threshold AND `mode='targeted'` (default aggressive always proceeds)
- A resolved slot's confidence is below threshold + user hasn't already answered that slot
- A metric/dimension/filter member is absent from `/meta` (unresolved ref)
- A snapshot-cube measure is requested but the user's prior context mentions a time range

**Decision made by `modeGate()` at `nl-to-query/index.ts:103`:**
```ts
const action = modeGate({
  mode: input.mode,                      // 'targeted' | 'aggressive'
  overallConfidence: overall,            // 0–1
  clarifications,                        // Array of bilingual Qs
  threshold,                             // config.disambigAutoThreshold
});
```

**Result returned to LLM:** If `action='clarify'`, include a single bilingual clarification question. LLM renders it as a user prompt + pauses for input. When the user replies (e.g., "ARPU" or "by country"), the next turn calls `disambiguate_query` again with the user's response, and memory persists the slot.

---

## Where nl-to-query Meets Tools

**Not before the tool loop — inside it.**

The system prompt does NOT invoke nl-to-query upfront. Instead:
1. LLM sees the user message.
2. If the LLM needs to understand a metric or dimension, it calls `disambiguate_query`.
3. `disambiguate_query` calls `disambiguate()` (the nl-to-query engine).
4. Engine returns action + query + slots.
5. LLM either asks the user (if clarify) or proceeds to `preview_cube_query` / `emit_query_artifact`.

**Example flow:**
- User: "Show me DAU by country last week."
- LLM: `disambiguate_query("Show me DAU by country last week.")`
  - Engine: "DAU" → metric ✓, "by country" → dimension ✓, "last week" → timeRange ✓
  - Returns: `action='auto', query: { measures: ['Users.Daily'], dimensions: [...], ... }`
- LLM: "Great! I resolved all slots. Now I'll call `preview_cube_query` to fetch the data."
- LLM: `preview_cube_query(query)` → rows
- LLM: `emit_query_artifact(title, summary, query, chart)` → SSE event + deeplink

---

## Load-Bearing Files & Citations

| File | Key Function | Line(s) |
|------|--------------|---------|
| `api/turn.ts` | HTTP entry point + SSE stream orchestration | 87–868 |
| `api/turn.ts` | Agent loop: `for await (const event of claudeRunner.run(...))` | 549–588 |
| `api/turn.ts` | Artifact collection via sseEmitter listener | 429–444 |
| `core/claude-runner.ts` | SDK subprocess + tool binding + message iteration | 130–298 |
| `core/intent-router.ts` | Skill routing by keyword + slash alias | 1–50 |
| `tools/registry.ts` | Tool definitions + buildSdkTools() | 39–154 |
| `tools/disambiguate-query.ts` | NL-to-query entry; memory bridge; /meta validation | 80–179 |
| `nl-to-query/index.ts` | Language detect → glossary → slot extract → compose → clarify → modeGate | 51–110 |
| `tools/emit-query-artifact.ts` | Artifact validation + deeplink build + SSE emit | 73–189 |
| `tools/emit-chart.ts` | Chart spec validation + top-N truncation + SSE emit | 60–94 |

---

## Synthesised summary (distilled)

**Architecture: one LLM, a tool registry, and a pre-baked deterministic resolver.**

Single Claude-with-tool-use loop — not planner/executor, not a graph. The LLM is the orchestrator; everything else is either a tool it can call or a deterministic pipeline that one of those tools wraps.

```
POST /agent/turn  (api/turn.ts:87)
  │
  ├─ validate (X-Cube-Workspace, X-Cube-Game, ownerId)
  ├─ acquire per-session mutex
  ├─ compose system prompt + load chat history
  │
  └─ claudeRunner.run({ tools, systemPrompt, message })   (core/claude-runner.ts)
        │   spawns Anthropic SDK with in-process MCP tool server
        │
        └─ LLM loop:  text ⇄ tool_use → tool handler → tool_result → …
                            │
                            ├─ disambiguate_query    ←── invokes nl-to-query pipeline
                            ├─ get_cube_meta         ←── cube schema fetch (compact by default)
                            ├─ preview_cube_query
                            ├─ emit_query_artifact   ──▶ SSE 'query_artifact' event ──▶ FE
                            ├─ emit_chart            ──▶ SSE 'chart' event ──▶ FE
                            ├─ list/get_business_metric, list/get_segment
                            ├─ explain_cube_sql, parse_date_range
                            └─ update/get_business_metric_trust, _history
        │
        └─ stop_reason='end_turn' → persist turn (text + artifacts + charts)
```

### Two folders, two layers

| Folder | Role | Who calls it |
|---|---|---|
| `tools/` | LLM-callable surface — tool_use defs + handlers, closure-bound to `ToolContext(ownerId, gameId, sessionId, sseEmitter, db)` via `registry.ts:buildSdkTools` | The LLM, via tool_use |
| `nl-to-query/` | Pure heuristic resolver. **Zero LLM calls.** Turns NL → candidate Cube Query JSON + confidence scores + clarification questions | Wrapped by exactly **one** tool: `disambiguate_query` |

The conveyor belt is not flat: the LLM doesn't directly call `slot-extractor` or `metric-resolver`. It calls `disambiguate_query`, that tool runs the whole `nl-to-query` pipeline, and returns either `{action:'auto', query}` or `{action:'clarify', questions}`.

### Artifact = SSE event + DB-persisted side-effect

| Tool | Validates | Emits | Returns to LLM |
|---|---|---|---|
| `emit_query_artifact` | members exist in /meta, dates normalised, deeplink UUID minted | SSE `query_artifact` → FE renders "Open in playground" pill | `{ ok, id, deeplinkUrl }` |
| `emit_chart` | ChartSpec valid, top-N truncation applied | SSE `chart` → FE renders inline chart | `{ ok, id, truncated }` |

SSE listeners (`api/turn.ts:429-444`) collect both into arrays; at end-of-turn `chatStore.appendTurn({ artifacts, charts })` persists alongside assistant text.

### What this design is good and bad at
- **Good:** deterministic, debuggable query composition; LLM does *intent + glue + presentation*, not parsing. Cheap on tokens. Heuristics are unit-testable.
- **Risk:** `disambiguate_query` is doing a lot — all seven `nl-to-query` stages share one failure surface. When a metric isn't resolved, you can't easily ask "which stage missed?" without re-running with logging.
- **Tradeoff:** decomposing `nl-to-query` into individual tools (an opt-in for `parse_date_range` already exists) gives the LLM finer control but inflates the tool catalogue + tool_use rounds.

---

## Cube meta sizing — is the whole `/meta` fed to the LLM?

**No, not by default. Three layers of optimisation are already in place, but no semantic/per-cube filtering yet.**

### 1. System prompt does NOT inline meta
`core/mode-prompts.ts:compose()` only reads `cube-playground.md` master command + skill files. Zero schema is pre-baked into the system message. The LLM only sees meta if it calls `get_cube_meta`.

### 2. `get_cube_meta` returns **compact** by default
`tools/get-cube-meta.ts:34-41` — default `scope='compact'` strips everything except `{name, title, type}` per measure/dimension. Stripped: SQL, segments, joins, time dimensions, formats, drillMembers, filters, sub-meta. `scope='full'` is opt-in and the LLM has to explicitly request it.

```ts
// scope='compact' (default)
{ cubes: [{ name, title, measures: [{name,title,type}], dimensions: [{name,title,type}] }] }

// scope='full' — raw /meta JSON (everything)
```

### 3. Two-level caching
- **L1: in-memory LRU** (`core/cube-meta-cache.ts`): TTL 60s, max 50 entries, keyed by `(workspace, gameId)`. All tools in the same turn hit one cached read.
- **L2: response-cache hash** (`getMetaVersion`): sha256 of a stable schema subset becomes `cubeMetaHash`, part of the response-cache key. When meta changes, cached turn responses bust automatically.

### What's NOT optimised (headroom)

| Gap | Today | Possible |
|---|---|---|
| Cube prefilter on prod (79 cubes) | LLM gets all 79 in one compact payload | Pre-filter by active game's prefix before returning — same trick the FE does with `cubeFilter` in `QueryBuilder.tsx:154` |
| Semantic search over meta | LLM scans linearly | Add a `search_cube_meta(query)` tool returning top-k cubes by name/title match — let the LLM narrow before reading full |
| Lazy measure/dimension expansion | Compact still lists every member name | `get_cube_meta({cubeName})` to fetch one cube's full detail on demand |
| System-prompt cache | `# cache-bust:{turnId}` appended (`claude-runner.ts:176`) intentionally **defeats** Anthropic prompt cache | If skill meta is stable per session, move the cache-buster to a message instead of the system prompt to recover prefix caching |

**Bottom line:** the FE-side prefix filter (`cubeName.startsWith(prefix + '_')`) is the obvious next win for prod — right now on prod cube-api the LLM sees `ballistar_*`, `cfm_*`, `cros_*` *together* in one game's meta payload, which is wasteful when the active game is e.g. ballistar.

---

## Unresolved Questions

- Should the prod meta payload be pre-filtered by `workspace.gamePrefixMap[gameId]` inside `get_cube_meta` (server-side), or kept LLM-visible for cross-game queries (which the FE intentionally allows)? Likely: server-side filter + an opt-in `includeAllPrefixes: true` arg.
- Is the deliberate cache-bust at `claude-runner.ts:176` still needed now that meta is fetched on demand? If skill meta is the only thing that changes per turn, prompt-cache prefix could be recovered.
