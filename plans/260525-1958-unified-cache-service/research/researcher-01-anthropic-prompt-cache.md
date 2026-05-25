# Anthropic Prompt Cache — Constraints & SDK Status

**Date:** 2026-05-25
**Scope:** Phase 02 (Anthropic-native prompt caching) — whether/how `cache_control` is reachable through `@anthropic-ai/claude-agent-sdk` v0.3.150 used by chat-service.

## TL;DR — Phase 02 must change direction

The Claude Agent SDK does NOT currently expose `cache_control` to userland. Issue #89 (anthropics/claude-agent-sdk-typescript, open as of late 2025): "no way of controlling cache points, and how the token cache is utilised."

However, the SDK already applies prompt caching **automatically** — issue #188 documents that the Agent SDK silently writes to `ephemeral_1h_input_tokens` (1h TTL, 2× write cost) rather than the documented 5m default.

**Implication:** Phase 02 should NOT try to wedge a `cache_control` block into the existing `query()` call (the SDK options surface doesn't accept it). Instead it should:

1. **Verify** current caching behavior already happens (turn.ts already captures `cache_creation_tokens` / `cache_read_tokens` via line 433–434).
2. **Pin** the system-prompt prefix so the SDK's automatic cache walks find it identically across turns (today the system prompt is recomposed per turn via `compose()` — if its head bytes are stable, the cache hits; if any preamble bit changes, it misses).
3. **Document** that explicit per-skill breakpoints are blocked on SDK enhancement (#89). The "kill switch" is a separate env `ANTHROPIC_PROMPT_CACHE_ENABLED` we will introduce, but in practice it can only opt OUT (by rotating a noise byte at prefix start) — there is no opt-IN call site.

## Key Mechanics (from docs)

- **Where:** `cache_control: {type: 'ephemeral'}` is placed on the last cacheable content block (tools, system, messages — in that order). Tools first, then system, then messages.
- **Min token threshold:** Sonnet 4.6 = 1,024 tokens; Haiku 4.5 = 4,096; Opus 4.7 = 4,096. Sub-threshold prompts are silently uncached (no error).
- **TTL:** Default ephemeral = 5 min. Optional 1h = 2× write cost vs 1.25× for 5m. Read = 0.1× base.
- **Breakpoints:** Up to 4 explicit per request. Automatic caching uses one slot. SDK's auto-cache appears to allocate a 1h breakpoint at the system prompt.
- **Key derivation:** Prefix-based cryptographic hash. ANY change in tools/system bytes before the breakpoint invalidates ALL downstream cache levels (tools→system→messages cascade).
- **Lookback:** Cache walker checks 20 prior blocks for prefix matches.

## chat-service Implications

| Component | Today | After Phase 02 |
|-----------|-------|---------------|
| `claude-runner.ts:135` `query()` call | `systemPrompt` as a single string | Same string — no SDK option to mark it cacheable; rely on automatic. |
| `chat_turns.cache_creation_tokens` / `cache_read_tokens` | Captured (turn.ts:433) | Surface in DevAudit; verify they are non-zero for turns 2+ in a conversation. |
| Tool registry serialization | Recomputed each turn (registry.ts) | Verify the SDK serializes tools in stable order; if not, the prefix changes per turn and cache misses. |
| Kill switch | None | `ANTHROPIC_PROMPT_CACHE_ENABLED` — when `false`, prepend a random nonce byte to systemPrompt (forces miss). Default `true`. |
| Per-skill cache breakpoints | Not available | DEFER until SDK #89 lands. Track as Phase-02 follow-up. |

## Prefix Stability Check (mandatory)

The `compose()` function (chat-service/src/core/mode-prompts.ts) builds the system prompt as:
```
masterPrompt + skillBody + contextPreamble + gameContext
```

For automatic caching to hit on turn 2+ within a chat-service session:
- `masterPrompt` must be byte-identical across turns. (It is — singleton memoization.)
- `skillBody` must be identical IF intent routes to the same skill. (Mostly true; switching skills = miss, which is correct behavior.)
- `contextPreamble` — varies per request when `body.context` is set. Verify whether this is upstream-pinned or freshly stringified. **If it's freshly stringified, JSON key order may rotate → prefix changes → cache miss.** Mitigation: normalize via `JSON.stringify(obj, Object.keys(obj).sort())`.
- `gameContext` — likely per-game stable, so cache hits are scoped per-game (acceptable).

Phase 02 must include a prefix-stability test: snapshot the systemPrompt produced for the same intent + game across two turns and assert byte-equality.

## What Phase 02 Actually Delivers

1. **Verify** SDK auto-cache is firing (audit `cache_creation_tokens` > 0 on turn 1, `cache_read_tokens` > 0 on turn 2 with same session+game+skill).
2. **Stabilize** prefix bytes — normalize `contextPreamble` JSON ordering; document this guarantee in `compose()`.
3. **Add kill switch** `ANTHROPIC_PROMPT_CACHE_ENABLED` (default true). Off = prepend ephemeral nonce.
4. **Cache-bypass header** `X-Bypass-Prompt-Cache: 1` mirroring existing `X-Bypass-Cache: 1`. Same nonce strategy.
5. **Surface metrics** — add `cacheCreationTokens` / `cacheReadTokens` aggregates to DevAudit cache tab under a new "Prompt Cache (Anthropic)" segment, separate from local cache surfaces.

## Open Questions

- Does the SDK accept a `cacheControl` option in a forthcoming minor version? Pin SDK in lockfile until verified.
- Once #89 lands and we can mark tool definitions cacheable, will we hit `cube-playground-tools` schema bytes changing turn-to-turn (e.g. ordered allowedTools)? Defer.
- Is the SDK's 1h-vs-5m TTL drift (issue #188) costing us 0.75× the 5m equivalent for cache writes that never re-read? Worth tracking but small absolute impact at our QPS.

## Sources

- [Prompt Caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [SDK issue #89 — Cache Control](https://github.com/anthropics/claude-agent-sdk-typescript/issues/89)
- [SDK issue #188 — 1h default TTL](https://github.com/anthropics/claude-agent-sdk-typescript/issues/188)
- [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)
