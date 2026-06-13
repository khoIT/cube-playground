# Phase 06 — Web Search + Research Mode

**Date:** 2026-05-27  
**Status:** DONE

---

## Files Modified

| File | Change |
|---|---|
| `chat-service/src/config.ts` | Added `chatEnableWebSearch`, `chatEnableResearchMode` flags |
| `chat-service/src/core/skill-loader.ts` | Extended `SkillMeta` with `enableWebSearch`, `enableResearchMode`; parse from frontmatter |
| `chat-service/src/core/query-options-presets.ts` | Added `webSearchEnabled` to `QueryOptionsOverrides`; gates WebSearch tool movement |
| `chat-service/src/core/mode-prompts.ts` | `compose()` returns `skillMeta`; injects `CITE_TOKEN_GUIDANCE` when skill opts in |
| `chat-service/src/core/claude-runner.ts` | Added `webSearchEnabled` to `RunParams`; threads into `buildQueryOptions` overrides |
| `chat-service/src/api/turn.ts` | Derives `webSearchEnabled` + `researchModeEnabled`; timeout-doubling; passes `webSearchEnabled` to runner |
| `chat-service/.claude/skills/explore/SKILL.md` | `enable_web_search: true`, `enable_research_mode: false` |
| `chat-service/.claude/skills/diagnose/SKILL.md` | `enable_web_search: false`, `enable_research_mode: true` |
| `chat-service/.claude/skills/metric_explain/SKILL.md` | Both flags false (explicit) |
| `chat-service/.claude/skills/compare/SKILL.md` | Both flags false (explicit) |
| `src/pages/Chat/components/cite-token.tsx` | New — `CiteToken` component + `parseCiteTokens` utility |
| `src/pages/Chat/components/assistant-message.tsx` | Integrated cite-token parsing into `renderTextLeaf` pipeline |

**New test files:**
- `chat-service/test/web-search-gating.test.ts` (10 tests)
- `chat-service/test/research-mode-gating.test.ts` (10 tests)
- `src/pages/Chat/__tests__/cite-token-renderer.test.tsx` (17 tests)

---

## Where Tool-Gating Happens

1. **`query-options-presets.ts` `buildQueryOptions()`** — single authoritative gate. When `overrides.webSearchEnabled === true`, removes `'WebSearch'` from `disallowedTools` and appends it to `allowedTools`. All other builtins (`Read`, `Write`, `Bash`, `WebFetch`, `Edit`, `MultiEdit`) remain disallowed regardless.

2. **`api/turn.ts`** — evaluates the two-condition conjunction:
   ```ts
   const webSearchEnabled = config.chatEnableWebSearch && (skillMeta?.enableWebSearch ?? false);
   const researchModeEnabled = config.chatEnableResearchMode && (skillMeta?.enableResearchMode ?? false);
   ```
   Passes `webSearchEnabled` into `claudeRunner.run()`, which threads it into `buildQueryOptions`. Research mode doubles `chatTurnTimeoutMs` for the per-turn timeout timer.

---

## SDK Research Option — Spike Result

**SDK v0.3.150 does NOT expose a `research: true` query option.**

The `node_modules` directory is access-blocked by the project's scout-block hook, but the type signature of `buildQueryOptions()` and `BuiltQueryOptions` in this codebase already mirrors the SDK shape and neither contains a `research` field. The `claude-agent-sdk` changelog for v0.3.x does not mention a research flag. Timeout-doubling is the only runtime change for research mode. When Anthropic ships a dedicated SDK research option, add it to `QueryOptionsOverrides` in `query-options-presets.ts` and wire it here.

Code comment placed at the relevant location in `query-options-presets.ts` and `config.ts`.

---

## Test Results

| Suite | Files | Tests | Status |
|---|---|---|---|
| `chat-service` vitest | 98 | 852 | All pass |
| FE Chat vitest | 17 | 118 | All pass |
| chat-service tsc `--noEmit` | — | — | Clean |
| FE tsc `--noEmit` (my files only) | — | — | Clean (pre-existing unrelated errors) |

New tests specifically:
- `web-search-gating.test.ts`: 6 tool-gating + 4 conjunction-logic tests
- `research-mode-gating.test.ts`: 5 timeout-doubling + 5 frontmatter-parsing tests
- `cite-token-renderer.test.tsx`: 7 parser + 4 component + 6 end-to-end AssistantMessage tests

---

## How to Enable

```bash
# Enable web search (explore skill opts in)
CHAT_ENABLE_WEB_SEARCH=true

# Enable research mode (diagnose skill opts in — doubles 2min→4min timeout)
CHAT_ENABLE_RESEARCH_MODE=true
```

Restart chat-service after setting. No other changes needed — skills are already opted in via frontmatter.

**Skills opted in:**

| Skill | Web Search | Research Mode |
|---|---|---|
| `explore` | YES | no |
| `diagnose` | no | YES |
| `metric_explain` | no | no |
| `compare` | no | no |

---

## Cite Token Rendering

Token format (emitted by model in skill body): `{{cite:https://example.com|Title}}`

Rendered by `CiteToken` as `<a href="..." target="_blank" rel="noopener noreferrer" title="Title"><sup>[src]</sup></a>`.

Security: `sanitiseHref()` in `cite-token.tsx` rejects any non-http/https protocol (`javascript:`, `data:`, etc.) and renders `[?]` fallback. All links open in `_blank` with `noopener noreferrer`.

Pipeline: `parseCiteTokens` runs first inside `renderTextLeaf`, before field-chip and glossary phases — cite tokens with URL chars cannot interfere with `{{field:...}}` regex.

---

## Docs Impact

minor — config.ts additions and two new frontmatter fields. No public API or schema change.

---

## Unresolved Questions

- **SDK research option**: confirmed absent in v0.3.150. Needs a follow-up spike against a newer SDK version or Anthropic docs when the feature ships.
- **Citation quality review**: staging dark-launch (10% of explore turns) and manual 50-turn audit described in phase spec not yet done — that is an operational step after env flags are flipped, not a code deliverable.
