# Monet v1.3 Chat Agent Architecture Scout Report

**Date:** 2026-05-23 | **Explorer:** Scout Agent | **Target:** monet-v1.3-20260519

**Goal:** Map chat-agent → NLP query → backend MCP execution pipeline for replication in cube-playground.

---

## 1. High-Level Architecture

### What is Monet?

**Monet** is a **standalone FastAPI service** (port 3002) that provides AI advisory capabilities for Pistol (payment dashboard). Acts as intelligent middleware between FE and data sources.

- **LLM Provider:** Anthropic Claude (via VNG internal LiteLLM proxy)
- **Deployment Shape:** FastAPI + Claude Agent SDK subprocess (v1.2 migration from CLI)
- **Architecture Style:** Request-response with SSE streaming; stateful session management

### Key Facts

| Aspect | Detail |
|--------|--------|
| **Framework** | FastAPI 0.104+ (async) |
| **AI Engine** | claude-agent-sdk (wrapper around Claude Code CLI subprocess) |
| **MCP Integration** | 4 servers: vng-gds (10 tools), monet-atlassian (3 tools), prometheus, pmt |
| **DB Backend** | SQLite (dev) OR MySQL pistol_db (prod) with `monet_*` prefix |
| **Streaming** | Server-Sent Events (10 event types) |
| **Session State** | DB-persisted (turn history, audit logs, metadata) |

### Stack

```
FE (React/Next.js) 
  ↓ HTTP POST + SSE
FastAPI Service (3002)
  ├─ Session manager (per-turn lock + state tracking)
  ├─ Intent router (keyword heuristic → skill auto-route)
  ├─ Skill loader (markdown SKILL.md prompt builder)
  ├─ Mode prompts (compose system_prompt: master + skill + thinking)
  ├─ Claude Agent SDK (process wrapper)
  └─ MCP direct caller (bypass Claude for pure data fetch)
    ↓
  MCP Servers (stdio + HTTP)
    ├─ vng-gds (Node, OAuth2 gateway)
    ├─ monet-atlassian (Python stdio)
    ├─ monet-prometheus (Prometheus REST)
    └─ monet-pmt (PEN CMDB REST)
```

---

## 2. Chat Agent Code Path

### HTTP Entrypoints

**File:** `src/main.py` (lines 59–80)

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/v1/agent/chat` | POST | `chat.router` (SSE) | **Stream chat** — recommended |
| `/api/v1/agent/chat-sync` | POST | `chat.router` | Sync chat (blocking, for debug) |
| `/api/v1/agent/compact` | POST | `compact.router` | Compress full session → summary + new session |
| `/api/v1/data/call-tool` | POST | `data.router` | Direct MCP (bypass Claude, 0-token cost) |
| `/api/v1/session/{id}` | GET/DELETE | `session.router` | Query metadata + history, or terminate |
| `/api/v1/structured/generate` | POST | `structured.router` | Proactive structured generation (JSON schema) |

**File:** `src/api/chat.py` (lines 1–150)

### Agent Loop & Orchestration

**Architecture:** Claude Agent SDK (v1.2 migration, replaces CLI subprocess hardcoding)

**Flow:**

1. **Request parse** (chat.py:81–150):
   - Extract `ChatRequest { session_id, query, context: { page, filters, blocks } }`
   - Call `_extract_modes()` → detect skill intent, thinking, search flags
   - Call `_build_context_preamble()` → inject user page + block context

2. **Intent router** (intent_router.py):
   - Keyword-based heuristic (VN + EN) on cleaned query
   - **Skills detected:** diagnose, compare, forecast, risk-scan, strategy, audit, search-broad
   - Confidence score + auto-route flag if high confidence (skip if user explicit `/skill name`)

3. **Mode prompt builder** (mode_prompts.py:58–101):
   - ALWAYS load master command: `.claude/commands/monet.md`
   - Load slash command body if `/<cmd>` prefix detected
   - ALWAYS load chart-output skill (auto-emit chart blocks)
   - Load deep_variant skill if routed/explicit
   - Append THINKING fragment if `thinking=true`
   - **Result:** composed system_prompt injected via SDK

4. **Claude SDK execution** (cli_runner.py:105–250):
   - Build `ClaudeAgentOptions`:
     - `system_prompt` = composed modes
     - `session_id` = resume UUID (validate UUID format)
     - `allowed_tools` = 13 MCP tools (vng-gds 10 + atlassian 3)
     - `disallowed_builtin_tools` = [Read, Write, Bash, WebFetch, etc.] (advisory service, no coding)
     - `--bare` flag = skip Claude auto-load, inject system_prompt manually
     - `mcp-config` = `.claude/.mcp.json`
   - Call `sdk_query(prompt=query, options=options)` → async iterator
   - Consume SDK Message objects (typed) → parse content blocks

5. **SSE stream coordinator** (sse_stream.py:40–120):
   - Consume SDK Message objects from stream_claude()
   - Map SDK types → Monet SSE events (10 types):
     - `loading` → init
     - `thinking` → reasoning blocks (dedupe logic)
     - `tool_call` + `tool_call_args` → MCP dispatch
     - `tool_result` → tool output + elapsed time
     - `token` → text streaming (partial)
     - `result` → final answer + cost
     - `error` → exception
     - `done` → EOF
   - Emit `sse_event(type, data)` per message

6. **Session state** (session_manager.py):
   - Per-session `asyncio.Lock` (prevent concurrent turns)
   - Turn count tracking → threshold warning (10/20 turns)
   - Auto-compact trigger at 80% context (future v2)

### Tool Definitions

**13 MCP tools registered via `.claude/.mcp.json`:**

**VNG GDS (10):**
- `game_list`, `game_search`, `game_currency_lookup`
- `payment_realtime`, `payment_daily`, `payment_revenue_monthly`, `payment_order_success`, `payment_iap_refund_daily`
- `webshop_daily`, `webshop_monthly`

**Monet Atlassian (3):**
- `search_jira`, `search_confluence`, `read_confluence`

**Monet Prometheus:**
- `query`, `query_range`, `labels`, `label_values`

**Monet PMT:**
- `get_all_alert_firing`, `list_alert`, `health`

### System Prompts

**Master command:** `.claude/commands/monet.md` (loaded ALWAYS)
- Identity + persona (Monet advisor character)
- Tool rules + output formatting
- Fallback routing logic if skill auto-route fails

**Skills (loaded on-demand):** `.claude/skills/<name>/SKILL.md`
- Example (`diagnose`): symptom → hypothesis tree → evidence check → root cause → mitigation
- Format: YAML frontmatter + markdown body (no Python involved)
- Restart Monet to reload (lru_cache reset)

**Conversation state:**
- **In-memory:** `asyncio.Lock` per session_id
- **Persisted:** SQLite/MySQL (`monet_sessions`, `monet_turn_history`, `monet_llm_call_audit`)
- No Redis (POC v1)

### Streaming Mechanism

**SSE (Server-Sent Events):**
- FE opens persistent POST with `Accept: text/event-stream`
- BE streams JSON-formatted events: `event: <type>\ndata: <json>\n\n`
- FE reads stream via `fetch().body.getReader()` + `TextDecoder` (pistol-fe/lib/mornet/client.ts:55–103)
- 10 event types allow FE to show: loading spinner → reasoning trace → tool calls → token-by-token text → final answer + cost

---

## 3. Schema/Context Loading

### Knowledge Ingestion

**Pattern A (current POC):** Markdown files in `docs/knowledge/`

- **Path:** `docs/knowledge/`
- **Structure:** INDEX.md + pistol/ subfolder
- **Size:** < 30 files (no vector DB needed)
- **Loading:** NOT auto-loaded at startup. Skills mention tools + files to fetch (e.g., "fetch Confluence postmortem doc PAY-1283")
- **Future v2:** Wiki engine (khi > 30 files)

### MCP Tool Discovery

Tools auto-discovered by Claude Agent SDK:
1. SDK reads `.claude/.mcp.json` (server config)
2. Spawns each MCP server (stdio process)
3. Calls `initialize` → server returns tool list
4. Claude sees tools in completion + auto-uses them

**MCP Servers Config:** `.claude/.mcp.json` (lines 1–44)

### Schema Injection

**System prompt composition (mode_prompts.py:73–95):**
- Master command (identity + routing)
- Slash command (if /persona etc)
- Chart output skill (always)
- Deep variant skill (if diagnose/compare/etc)
- Thinking fragment (if /think)

**Context preamble (chat.py:38–70):**
```
[Context người dùng]
Page: psp-health
Selected block: PSP Health · MoMo
Attached blocks (2):
1. Jira PAY-1283: MoMo timeout incident
2. Confluence postmortem: root cause analysis
```

**Context token count:** ~2–8K tokens max (master 1.5K + skill 1–3K + knowledge snippet 0.5–2K)

---

## 4. Query Execution Layer

### Query Execution (NOT SQL Generation)

Monet does NOT generate SQL. Instead:

1. **Claude interprets query** via system prompt + skills
2. **Claude decides which MCP tool to call** (payment_daily, game_search, etc.)
3. **SDK dispatches tool** with args (structured)
4. **Tool returns JSON result** (rows, not SQL)
5. **Claude summarizes** result in English for user

### MCP Tool Dispatch

**Direct MCP (bypass Claude):** `POST /api/v1/data/call-tool`

Used for KPI cards that just fetch data without reasoning:
- Cost: 0 token cost vs 3–8s with Claude reasoning

**DB Connection:**
- Backend abstraction (db/adapter.py)
- Init via `db_backend` env var (sqlite | mysql)
- Swap driver: `aiosqlite` (SQLite) OR `asyncmy` (MySQL async)

**Tables (all prefixed `monet_`):**
- `monet_sessions`, `monet_turn_history`, `monet_llm_call_audit`, `monet_mcp_call_audit`
- `monet_hmac_audit`, `monet_rate_limit_buckets`

**No pre-execution preview.** Results streamed back immediately.

---

## 5. Frontend Integration & Deeplink/Navigation

### Frontend Stack

**Monorepo:** `pistol-fe/` (decoupled in v1.3)
- `apps/web/` — Next.js React FE
- `apps/api/` — Node.js proxy (optional)

### Chat UI Components

**File:** `pistol-fe/apps/web/components/layout/`

- **MonetPanel.tsx** — main chat sidebar
  - Multi-turn chat history, slash commands, file attachments, mode toggles, resizable

- **MonetReasoning.tsx** — reasoning trace visualization
  - Timeline of steps, expandable tool calls, cost + duration summary

- **MonetChart.tsx** — chart renderer
  - Parse chart JSON blocks, render via Chart.js

- **MonetPicker.tsx** — block/attachment selector
  - `/pick <name>` command → inject into context

### Monet Client Library

**File:** `lib/mornet/client.ts` (lines 1–150)

- Fetch + ReadableStream (NOT EventSource, which doesn't support POST)
- Parse SSE blocks
- Callback per event → FE updates UI
- AbortSignal support (user cancel)

### Deeplinks & Navigation

**NOT implemented in v1 POC.** Current behavior:
- Monet outputs markdown (tables, text, code blocks)
- FE renders markdown as-is
- Click on link in text (if markdown link) → navigate

**Future v2 opportunity:**
- Monet could emit structured metadata blocks for clickable navigation
- FE parses + renders as clickable card → navigate to Jira/Grafana/etc

---

## 6. Configuration & Secrets

### Environment Variables

**Required (LLM):**
```bash
ANTHROPIC_BASE_URL=https://aawp-litellm-testing.vnggames.net
ANTHROPIC_API_KEY=<api-key-from-hung>
MONET_DEFAULT_MODEL=claude-sonnet-4-6
```

**Database:**
```bash
DB_BACKEND=sqlite  # or mysql
MONET_DB_PATH=./runtime/monet.db  # SQLite
MYSQL_HOST=localhost
MYSQL_DATABASE=pistol_db
MYSQL_TABLE_PREFIX=monet_
```

**MCP Gateway (VNG OAuth2):**
```bash
MCP_CLIENT_ID=<from-hung>
MCP_CLIENT_SECRET=<from-hung>
```

**Atlassian (optional):**
```bash
ATLASSIAN_CLOUD_ID=ab926f34-1cce-4303-b9b8-99dbf927e315
ATLASSIAN_USER_EMAIL=you@vng.com.vn
ATLASSIAN_API_TOKEN=<gen-from-id.atlassian.com>
```

Full reference: `.env.example` (lines 1–99)

---

## 7. Key Gotchas & Lessons Learned

### Known Limitations (POC v1)

| Issue | Workaround | v2 Plan |
|-------|-----------|---------|
| **No auth** | Run local only, behind VPN | BE proxy + CAS JWT + HMAC |
| **Single-user** | 1 Monet instance = 1 user at a time | Terminal pool per user |
| **Cold start per request** | Spawn Claude CLI subprocess per chat turn | Agent SDK persistent session |
| **Context overflow** | Manual `/compact` to summarize | Auto-compact at 80% threshold |
| **No output filter** | Data returned raw per MCP scope | Regex/LLM scan + PII mask |
| **No RBAC** | No scope filter | Inject permission context into system_prompt |
| **Windows subprocess hang** | `ProactorEventLoop` fix in `run.py` | Migrate to Agent SDK (cleaner) |

### Lessons from Development

1. **Windows asyncio issue (Phase 1):** CLI subprocess requires `ProactorEventLoop` on Windows, not default `SelectorEventLoop`. Solved via `asyncio.set_event_loop_policy()` at app startup (src/main.py:8–9).

2. **SDK migration (Phase 2, v1.2):** Replaced raw CLI subprocess with `claude-agent-sdk` → typed Message objects, cleaner error handling, auto-resume via `--resume <UUID>`.

3. **Skill markdown loading (Phase 6):** Owner edits `.claude/skills/<name>/SKILL.md` directly, BE loads via `skill_loader.py` + lru_cache.

4. **Master command pattern (v1.2, D15):** Centralize identity + routing rules in `.claude/commands/monet.md`, inject into every request.

5. **Intent router (POC):** Keyword heuristic (not ML classifier) works for MVP. Multi-skill match → returns None (user explicit). High-confidence single match → auto-route with flag.

6. **DB migration v1.3 (D19–D20):** SQLite → MySQL with `monet_*` prefix to share Pistol's `pistol_db`. Adapter pattern isolates driver swap.

---

## 8. Minimum Viable Chat-Agent Scaffold

### For Cube-Playground Replication

**What MUST be included:**

1. **FastAPI HTTP service** with 2 endpoints:
   - `POST /api/v1/agent/chat` — SSE streaming
   - `POST /api/v1/data/call-tool` — direct tool call

2. **Intent router + prompt builder:**
   - Keyword heuristic or simple pattern match → skill detection
   - YAML frontmatter + markdown skill files
   - Master command (identity/routing) + skill + thinking composition

3. **Claude Agent SDK wrapper:**
   - Initialize with system_prompt + session_id + MCP config
   - Async message iterator → SSE event mapper
   - Tool allowlist/disallowlist

4. **MCP tool registration:**
   - `.mcp.json` config for each tool server
   - Direct MCP caller (bypass Claude for data fetch)

5. **Session state + DB:**
   - Persist turn_history, metadata, cost audit
   - Per-session lock (prevent concurrent turns)
   - SQLite or PostgreSQL adapter

6. **FE streaming client:**
   - Fetch POST with `Accept: text/event-stream`
   - SSE block parser (event + data lines)
   - Callback per event type

**What CAN be skipped (Phase 2):**
- RBAC / permission layers
- BE proxy gateway (test FE → service directly)
- Output filtering / PII masking
- Distributed lock (use asyncio.Lock locally)
- Multi-tenant (1 user per instance)

---

## 9. File Reference

### Critical Paths

| File | Purpose | Lines |
|------|---------|-------|
| `src/main.py` | FastAPI app + lifespan + router registration | 1–90 |
| `src/api/chat.py` | POST /agent/chat handler | 1–350 |
| `src/core/cli_runner.py` | Claude SDK wrapper + message parsing | 1–300 |
| `src/core/sse_stream.py` | SDK Message → SSE event mapper | 1–350 |
| `src/core/intent_router.py` | Keyword heuristic + skill auto-route | 1–150 |
| `src/core/mode_prompts.py` | Compose system_prompt from modes | 1–120 |
| `src/core/skill_loader.py` | Load SKILL.md from disk + cache | 1–79 |
| `src/core/mcp_direct.py` | Direct MCP tool call (bypass Claude) | 1–150 |
| `src/db/adapter.py` | SQLite/MySQL abstraction | 1–180 |
| `.claude/.mcp.json` | MCP server config (stdio) | 1–44 |
| `.claude/commands/monet.md` | Master command (identity + routing) | — |
| `.claude/skills/diagnose/SKILL.md` | Example skill template | — |
| `.env.example` | All config vars documented | 1–99 |
| `pistol-fe/lib/mornet/client.ts` | FE SSE streaming client | 1–150 |
| `pistol-fe/components/MonetPanel.tsx` | Chat UI sidebar | 1–500 |

### Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Overview + setup + troubleshooting |
| `docs/integration/INTEGRATION-API.md` | HTTP API for FE integrators |
| `doc.plan.md` | v1.3 plan (DB migration + detach FE) |
| `HANDOFF-TRANG.md` | Quick onboarding for demo user |
| `CHANGELOG.md` | All releases + features |

---

## Summary

**Monet is a stateful AI advisor service that:**

1. **Accepts natural language queries** from FE via HTTP POST
2. **Routes to specialized skills** (diagnose, compare, forecast, etc.) via keyword heuristic
3. **Composes system prompt** from master command + skill + thinking
4. **Streams reasoning + tool calls** to FE via SSE (10 event types)
5. **Executes queries** by dispatching 13 MCP tools (VNG GDS, Atlassian, Prometheus, PMT)
6. **Returns markdown answer** with optional chart JSON blocks
7. **Persists session state** in SQLite/MySQL for multi-turn conversations

**No SQL generation.** Claude decides which MCP tool → tool returns JSON → Claude summarizes.

**Deeplinks/navigation** not yet implemented; opportunity for v2 to emit structured "click to open Jira/Grafana" actions.

For cube-playground, replicate: FastAPI + prompt builder + Claude SDK + MCP dispatcher + SSE client. Skip auth & RBAC (Phase 2).

---

**Report compiled:** 2026-05-23 14:43 UTC  
**Status:** COMPLETE — ready for architecture design  
**Next step:** Validate navigation pattern requirements before Phase 1 of scaffold
