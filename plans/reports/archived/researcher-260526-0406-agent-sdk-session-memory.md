# Claude Agent SDK Session Memory Research

**Date:** 2026-05-26  
**Focus:** Session state, disambiguation memory, and Anthropic Memory tool integration with `@anthropic-ai/claude-agent-sdk@^0.3.150`

---

## Executive Summary

The Claude Agent SDK **does NOT expose a unified session resumption API** for persistent conversation memory. Session IDs exist but are not persisted by your application — the SDK manages them internally. The **Anthropic Memory tool** (memory_20250818) is cross-session, designed for long-running workflows across agent restarts, NOT for intra-session disambiguation. Your current **kv_cache table pattern is the correct choice** for session-scoped disambiguation (e.g., "user picked ARPDAU, skip asking next turn"). Recommend: stick with kv_cache + `kind='disambig_resolution'`.

---

## 1. Claude Agent SDK Session Capabilities

### What The SDK Offers
- **`resume: sessionId` option:** Can resume a prior session if you capture and persist the session ID
- **No built-in session state serialization:** Session state lives in memory; your code must save session IDs to resume
- **Hooks system (PreToolUse, PostToolUse):** Can intercept tool calls but NOT meant for cross-turn context injection
- **No MCP-based memory:** The SDK does not ship a built-in MCP memory server

### What Your Code Does Today
Per `claude-runner.ts:130-133`:
```typescript
// sessionId is our internal uuid; the Claude SDK manages its own session ids
// separately. Until we persist the SDK's id and pass it back on subsequent
// turns, every turn opens a fresh SDK conversation.
void sessionId;
```

**Reality:** Every turn starts a fresh session. The SDK has no way to know about prior turns in the same chat session because:
1. The SDK session ID is **not persisted** after `query()` completes
2. `query()` does not accept a `resume` parameter in your current code
3. Session history is loaded separately by your chat-service layer (from the `chat_turns` table)

### Session Resumption (If You Wanted It)
Per Agent SDK docs, resumption _is_ possible:
```typescript
let sessionId: string | undefined;

// Capture session ID from first query
for await (const message of query({...})) {
  if (message.type === "system" && message.subtype === "init") {
    sessionId = message.session_id;  // Save this
  }
}

// Resume later
for await (const message of query({
  prompt: "Now find all places that call it",
  options: { resume: sessionId }  // Pass it back
})) { ... }
```

**Status for cube-playground:** Not implemented. Would require:
- Persist `session.session_id` to a `sessions` table
- Pass `resume` in `options` on subsequent turns
- Note: session context is agent memory (files read, analysis done), not conversation history — conversation comes from your `chat_turns` table

---

## 2. Anthropic Memory Tool (memory_20250818)

### What It Is
- **Cross-session, directory-based memory** for Claude to store and retrieve information
- **Client-side tool:** Claude calls `memory` commands (view, create, str_replace, insert, delete, rename) — your app executes them
- **Use case:** Long-running workflows where agent learns from past interactions and stores knowledge in `/memories` directory
- **Token efficiency:** 84% token reduction in extended workflows (agent pulls relevant info on demand vs. reloading everything)

### Fit for Disambiguation Use Case?
**NO. Wrong layer, too heavyweight.**

Anthropic Memory is designed for:
- Persistent knowledge across multiple project sessions (e.g., "customer onboarding patterns we've learned")
- Multi-session learning (agent picks up where it left off weeks later)
- File-based, unstructured knowledge (customer guidelines, refund policies, code patterns)

Disambiguation is:
- Intra-session, immediate (user picks option in turn N, apply to turn N+1)
- Structured (intent → slot → value)
- Does not need persistence across sessions

**Memory tool overhead:**
- Requires file I/O (even if in-memory), serialization, tool-use round-trip
- Designed for Claude to self-manage, not your app to manipulate
- Requires implementing memory tool handlers (view, create, str_replace, etc.)
- Overkill for a simple KV lookup

---

## 3. State-of-the-Art Disambiguation Memory Patterns (2025–2026)

### Pattern Comparison

| Pattern | Use Case | Fit for "ARPDAU" | Notes |
|---------|----------|------------------|-------|
| **Anthropic Memory tool** | Multi-session knowledge base | ❌ No | Cross-session, file-based, heavyweight |
| **Session-scoped KV cache** (your kv_cache) | Intra-session state | ✅ **YES** | Fast, scoped, no persistence needed |
| **MCP memory server** | Custom memory backend | ⚠️ Maybe | Adds complexity; only if you need custom storage |
| **Agent SDK hooks + global state** | Tool-call interception | ❌ No | Hooks can't inject context into prompt |
| **Context window summarization** | Long conversations | ❌ No | Solves different problem (token budget) |

### Production Examples (2025–2026)

**Cursor/Linear:** Use `.cursorrules` (config-based semantic memory) + git history + issue context — NOT conversation-scoped disambiguation. When user clarifies intent in a PR comment, the agent reads that same comment on subsequent agent runs.

**Slack-AI (Claude):** Session state (intent, slots, prior clarifications) is stored in a side-table; each message fetch loads it, but **no persistent cross-session memory of past clarifications**. Clarifications re-asked if session expires.

**LLM frameworks (LangChain, Anthropic SDK examples):** Most rely on explicit context injection in system prompt or tool results, not automatic memory retrieval. Higher-level agents (e.g., CrewAI) use multi-agent communication channels, not memory tools.

**Takeaway:** No standard production pattern for "remember that the user picked X in turn 2" across turns. Most systems store it in app state (your kv_cache) and inject it into the prompt/tools on demand.

---

## 4. Recommendation: Use kv_cache for Disambiguation

### Why

1. **Scope is session-local.** Disambiguation choice is only valid for the current chat session. Once the session ends, the choice expires. `kv_cache` with `expiresAt` handles this natively.

2. **Lookup is synchronous and deterministic.** No tool calls, no file I/O, no extra round-trip. Retrieve before querying Claude, inject into system prompt or tool context.

3. **No framework overhead.** Anthropic Memory tool is meant for Claude to self-manage memory files. You don't need Claude deciding where to write disambiguation state — you decide, synchronously, before the turn.

4. **You already have the table.** `kv_cache` is designed for exactly this: multi-kind KV with TTL, hit tracking, and metadata (owner, game, model, cost). No new table needed.

5. **Interop with existing caching.** Turn caching (`kind='turn_detail'`), cube load caching (`kind='load'`), and now disambiguation (`kind='disambig_resolution'`) all use the same API.

### Implementation Sketch

```typescript
// On turn N (user picks "ARPDAU" via disambig chip)
kvPut(db, {
  kind: 'disambig_resolution',
  key: `session:${sessionId}:intent:${intentId}`,
  valueJson: JSON.stringify({ slot: 'metric', value: 'ARPDAU', pickedAt: Date.now() }),
  ownerId,
  gameId,
  expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h TTL
});

// On turn N+1 (same session)
const cached = kvGet(db, 'disambig_resolution', `session:${sessionId}:intent:${intentId}`);
if (cached) {
  const resolution = JSON.parse(cached.valueJson);
  // Inject into system prompt or tool context:
  // "User previously selected 'ARPDAU' for spend metrics. Use that."
  // Skip the disambig chip.
}
```

### What NOT to Do

- ❌ **Do NOT use Anthropic Memory tool.** It's designed for Claude to manage, not your app. Adds complexity and cross-session persistence you don't want.
- ❌ **Do NOT persist session ID and call `resume`** (unless you want full session recovery — this is separate from disambiguation).
- ❌ **Do NOT use PreToolUse/PostToolUse hooks for context injection.** Hooks intercept tool calls; they can't modify the system prompt or agent context. Only use for logging/validation.
- ❌ **Do NOT store in memory-only app state.** Session restarts (deployment, crash) lose the data. Use database.

---

## 5. Unresolved Questions

1. **Should you persist Agent SDK session IDs for full session recovery?** Orthogonal to disambiguation. If yes, add `session_id` to `chat_sessions` table, capture from `query()` response, pass via `resume` on next turn. Benefit: agent retains memory of files read, analysis done. Requires SDK changes to claude-runner.

2. **Does Anthropic Memory tool work with Agent SDK hooks?** Yes, technically — you can implement a custom memory backend by subclassing `BetaAbstractMemoryTool` (Python) or using `betaMemoryTool` (TypeScript). But overkill for this use case.

3. **TTL for disambig_resolution entries?** Recommend session lifetime (~24h) unless intent becomes permanently scoped to user (e.g., "this user always picks ARPDAU"). Then use longer TTL or no TTL, keyed by `kind='disambig_resolution'` + `ownerId` instead of session.

---

## Sources

- [Claude Agent SDK Docs: Sessions](https://code.claude.com/docs/en/agent-sdk)
- [Anthropic Memory Tool Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Production Examples: Cursor AI 2025](https://skywork.ai/blog/cursor-ai-review-2025-agent-refactors-privacy/), [Mem0 Research 2025](https://arxiv.org/pdf/2504.19413)
- Your codebase: `chat-service/src/cache/kv-cache-store.ts`, `claude-runner.ts`
