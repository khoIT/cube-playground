# Activating the Chat Revamp — Dormant Flags, Glossary Reliability, Tool Toggles

**Date**: 2026-05-27 (afternoon, follows the parallel-emit-shim session)
**Severity**: Medium (turned shipped-but-dark features on; fixed two silently-dead surfaces)
**Component**: chat-service + main-server proxy + chat FE (glossary, composer, memory chip)
**Status**: Resolved — features live + verified; one LLM-reliability caveat noted

## The arc

Most of the agent-revamp phases were *coded and committed* but invisible in the running app. This session was about making them actually work end-to-end, and the recurring lesson was **"built ≠ wired ≠ enabled"**.

### 1. The proxy-gap class (bit us twice)

Phase-03 focus chip and Phase-04 cancel button both did nothing in the UI. Root cause both times: the route existed in chat-service (:3005) but the **main server (:3004) had no proxy handler** — the FE's `/api/...` call 404'd at :3004 and the client swallowed it (`null`/no-op), so it looked unwired when the backend was fine.
- Fixed: added GET/DELETE `/api/chat/sessions/:id/focus` and POST `/api/agent/turn/:turnId/cancel` proxy handlers.
- Sub-trap: `proxyJson` always sent `Content-Type: application/json` on bodyless POSTs → upstream `FST_ERR_CTP_EMPTY_JSON_BODY` 400. Only set the content-type when there's a body.
- Captured as a lessons-learned entry: **new chat-service route ⇒ add the twin main-server proxy, and test through :3004 not just :3005.**

### 2. Flags were off, not broken

`CHAT_GLOSSARY_V2` (the headline phase), `CHAT_ENABLE_WEB_SEARCH`, `CHAT_ENABLE_RESEARCH_MODE` all default off and weren't in `.env`. Enabling them (+ a `tsx watch` respawn via `touch` so dotenv re-reads) is what actually surfaced the features. Verifying "is it wired?" meant separating env-flag / per-skill-frontmatter / data-present / model-behavior layers — each can independently be the blocker.

### 3. Glossary 8→2: engine right, agent flaky

"top spenders this week" still clarified live even with the flag on. The resolver engine + concept data + 50-case eval were all correct (eval 100%). The gap was **the model sometimes didn't call `disambiguate_query` at all** and free-formed a clarifying question, or step-3 of the skill licensed ad-hoc clarification. Fix was prompt-level: made `disambiguate_query` the **only** source of a clarifying question and `action:auto` binding. Verified 3/3 resolves after. Caveat: it's an LLM prompt — strong evidence, not a guarantee; a server-side guard would be the deterministic next lever.

### 4. Phase 06 — web search real, research mode mostly a label

Web search = the native SDK `WebSearch` tool moved disallowed→allowed when env + per-skill (or per-turn toggle) opt in; FE renders `{{cite:url|title}}` footnotes. Research mode: **SDK v0.3.150 exposes no `research` option** — so it only doubles the turn timeout. Wired honestly, documented, no fake flag.

### 5. Tool-toggle UI churn (4 shapes)

The composer control went single "Research mode" → split → icon pills (via huashu-design principles, reusing the existing Bypass-cache pill language) → back to **two flip-switches "Web Search" + "DeepThink"** per the user's final call. Backend stayed two independent headers (`X-Web-Search` / `X-Research-Mode`) throughout. Lesson: confirm the *control model* (one vs two, switch vs pill) before building the wiring — the FE→proxy→service plumbing is identical regardless of skin, so skin churn is cheap but should still be one decision up front.

### 6. Modal scroll — half a recipe doesn't scroll

Glossary edit modal clipped the concept-tier fields. First fix (form `flex:1; min-height:0; overflow-y:auto`) wasn't enough — the flex-column **dialog** also needed `overflow:hidden; min-height:0` or the form grows to content instead of shrinking. The standard modal-scroll recipe needs both halves.

## Decisions / Lessons

- **Verify through the surface the user actually hits.** A green `curl` to :3005 proved nothing about the browser, which goes via :3004. Same for "flag in .env" vs "flag in the running process."
- **Separate the layers when a feature looks dead:** route exists? proxied? env flag on (in the *process*)? skill opted in? data present? model invoked the tool? Each was the culprit at least once today.
- **Cache can mask a fix:** the response cache replayed a stale clarification after the flag flip — always bypass cache when verifying a behavior change.

## Unresolved / Follow-ups

- Glossary auto-route reliability is prompt-enforced, not guaranteed — consider a server-side guard that refuses a model-authored clarification when `disambiguate_query` returned `auto`.
- Web-search citation quality is dark-launch/manual-review; not yet driven through a real external-concept question end-to-end.
- Research mode does nothing but extend the timeout until Anthropic ships an SDK research option.
- Tool toggles verified by typecheck + tests, not yet eyeballed in a running browser (side-pane crowding risk with two labelled switches).
