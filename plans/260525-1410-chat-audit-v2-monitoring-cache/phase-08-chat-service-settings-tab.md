# Phase 08 — Chat-Service settings tab

## Context Links
- `src/pages/Settings/settings-page.tsx:108` (tab registration)
- `src/pages/Settings/settings-tabs.tsx` (tab component)
- `chat-service/src/api/turn.ts:360` (model resolution — currently `config.chatModel`)
- `chat-service/src/config.ts:39,103` (chatModel default + env)
- Depends on phase 06 (cache bypass + clear endpoint)

## Overview
- Priority: P3
- Status: completed
- New `/settings` tab "Chat Service" exposes owner-level runtime toggles:
  cache bypass, clear-my-cache button, default model selector, show-debug-links toggle,
  raw-SDK-events default-expanded toggle.

## Key Insights
- Existing settings page already has a vertical-tab rail pattern — adding a new tab is one
  `SettingsTabDescriptor` entry + one rendered panel component. No router churn.
- Persistence split is intentional:
  - **localStorage (FE-only)**: show-debug-links, raw-events-default-expanded — pure UI
    state, no need to round-trip.
  - **localStorage + header (FE→BE)**: cache-bypass, default-model — read on every
    `/turn` call, sent as headers; chat-service honors when present.
  - **Backend route (FE→BE)**: clear-my-cache — destructive action, must go through API.
- Cache scope is **per-game (shared across owners)** per phase 06 decision. "Clear my
  cache" therefore clears the active game's cache, NOT just the owner's contributed rows.
  UI MUST make this scope explicit ("Clear cache for game X — affects all users of this
  game").
- Model selector: chat-service must allowlist the proxy's known models — never echo an
  arbitrary `X-Model` header value, to prevent client-side request smuggling.

## Requirements

Functional:
- New tab "Chat Service" appears in `/settings` (after existing tabs).
- Five controls in this order:
  1. **Default model** — `<select>` from allowlist; persists; sends `X-Model` header on `/turn`.
  2. **Bypass response cache** — toggle; persists; sends `X-Bypass-Cache: 1` on `/turn` when on.
  3. **Clear cache for current game** — button; confirms via dialog; POSTs to backend.
  4. **Show debug links on chat page** — toggle; persists in localStorage.
  5. **Show raw SDK events expanded by default** — toggle; persists in localStorage.
- Backend honors `X-Model` (allowlisted) and `X-Bypass-Cache` headers in `turn.ts`.
- Backend exposes `DELETE /debug/cache?game=<id>` — clears `response_cache` rows for the
  given game; owner-scoped via X-Owner-Id (any owner with sessions in the game can clear).

Non-functional:
- Settings UI shows current values on mount; saves debounced (250ms) to localStorage.
- Cache-clear shows row-count deleted in toast.
- All localStorage keys namespaced under `chat-service.<setting>` to avoid collision.

## Architecture

```
src/pages/Settings/
  settings-page.tsx          ← register new tab descriptor + render panel
  ChatService/
    chat-service-tab.tsx     ← orchestrator <200 LOC
    use-chat-service-settings.ts  ← localStorage-backed hook (get/set, JSON-typed)
    chat-service-model-select.tsx ← model dropdown
    chat-service-cache-controls.tsx ← bypass toggle + clear button + confirm dialog

src/services/chat-service-client.ts (extend)
  - sendTurnRequest(): read settings, attach X-Model + X-Bypass-Cache headers

chat-service/src/api/turn.ts
  - resolveModel(req, config): const requested = req.headers['x-model']; allowlist check;
    fallback config.chatModel
  - bypassCache = req.headers['x-bypass-cache'] === '1'

chat-service/src/api/debug.ts (new route)
  DELETE /debug/cache?game=<id>
    - owner = X-Owner-Id (required)
    - verify owner has at least one chat_session in this game
    - DELETE FROM response_cache WHERE game_id = ?  → return { deleted: <n> }
```

## Related Code Files

Modify:
- `src/pages/Settings/settings-page.tsx` — add tab descriptor + render branch.
- `chat-service/src/api/turn.ts` — model header resolution + bypass-cache header read.
- `chat-service/src/api/debug.ts` — new DELETE /debug/cache route.
- `chat-service/src/config.ts` — `allowedModels: string[]` config entry (default = list of 4 proxy models).
- `chat-service/src/types.ts` — extend turn request shape if needed.
- `server/src/routes/chat.ts` — proxy `DELETE /api/chat/debug/cache` to chat-service.
- `src/services/chat-service-client.ts` — header attachment.

Create:
- `src/pages/Settings/ChatService/chat-service-tab.tsx` — main panel (<200 LOC)
- `src/pages/Settings/ChatService/use-chat-service-settings.ts` — typed localStorage hook
- `src/pages/Settings/ChatService/chat-service-model-select.tsx`
- `src/pages/Settings/ChatService/chat-service-cache-controls.tsx`
- `src/pages/Settings/ChatService/__tests__/use-chat-service-settings.test.ts`
- `chat-service/src/api/__tests__/debug-cache-clear.test.ts`
- `chat-service/src/api/__tests__/turn-model-header.test.ts`

## Implementation Steps

1. **Settings hook**: `use-chat-service-settings.ts` exports
   ```ts
   interface ChatServiceSettings {
     defaultModel: string | null;        // null = use server default
     bypassCache: boolean;
     showDebugLinks: boolean;
     rawEventsDefaultExpanded: boolean;
   }
   useChatServiceSettings(): [ChatServiceSettings, (patch: Partial<ChatServiceSettings>) => void]
   ```
   Backed by localStorage key `chat-service.settings`; JSON-serialized; debounced write
   (250ms) via `setTimeout` ref pattern. Default values returned when missing/corrupt.

2. **Tab panel**: `chat-service-tab.tsx` orchestrates four small subcomponents (model
   select, cache controls, two toggles). Uses theme tokens from existing settings tabs
   for visual parity. <200 LOC.

3. **Model selector**: `chat-service-model-select.tsx` renders `<select>` populated from
   a const allowlist `CHAT_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6', 'claude-opus-4-7']`.
   Empty option = "Server default". Hint text below: "Overrides server default per
   request. Set in URL to scope to one chat (TBD)."

4. **Cache controls**: `chat-service-cache-controls.tsx` — bypass toggle + danger button.
   Button opens `<dialog>` confirm: "Clear cache for game <name>? This affects all users
   of this game (cache is shared per-game)." On confirm, POSTs to
   `DELETE /api/chat/debug/cache?game=<activeGameId>`, shows toast with `{ deleted }`
   row count. On error, toast error + log to console.

5. **Toggles**: two checkbox rows directly in the tab panel — show-debug-links and
   raw-events-default-expanded. Each reads/writes via the hook.

6. **Tab registration**: `settings-page.tsx` — add a new `SettingsTabDescriptor` with
   `id: 'chat-service'`, `label: 'Chat Service'`, `icon: <pick from lucide-react>`.
   Render `<ChatServiceTab/>` when active.

7. **FE header attachment**: `chat-service-client.ts` — in the `/turn` POST helper, read
   settings from the hook (or via a non-hook `readChatServiceSettings()` helper since
   client may not be in a React tree); attach:
   - `X-Model: <defaultModel>` if non-null
   - `X-Bypass-Cache: 1` if `bypassCache === true`

8. **BE model resolution**: `turn.ts` — add a `resolveModel(req, config)` helper:
   ```ts
   const requested = (req.headers['x-model'] as string | undefined)?.trim();
   if (requested && config.allowedModels.includes(requested)) return requested;
   return config.chatModel;
   ```
   Reject unknown models silently (fallback to default) — never echo unsanitized header
   value into the SDK call.

9. **BE config**: `config.ts` — add
   ```ts
   allowedModels: optional('ALLOWED_MODELS', 'claude-sonnet-4-6,claude-haiku-4-5,claude-opus-4-6,claude-opus-4-7').split(',').map(s => s.trim()).filter(Boolean)
   ```

10. **BE bypass-cache wiring**: `turn.ts` — before phase 06's cache lookup, check
    `req.headers['x-bypass-cache'] === '1'`. If true, skip lookup AND skip write (cache
    bypass should be symmetric — don't let a bypass-read still poison cache).

11. **BE clear endpoint**: `chat-service/src/api/debug.ts` —
    ```ts
    fastify.delete<{ Querystring: { game?: string } }>('/debug/cache', async (req, reply) => {
      const ownerId = extractOwnerId(req.headers);
      if (!ownerId) return reply.status(401).send(...);
      const gameId = req.query.game?.trim();
      if (!gameId) return reply.status(400).send({ error: 'Missing ?game=' });
      // Verify owner has at least one session in this game (defense-in-depth)
      const has = db.prepare('SELECT 1 FROM chat_sessions WHERE owner_id = ? AND game_id = ? LIMIT 1').get(ownerId, gameId);
      if (!has) return reply.status(403).send({ error: 'No sessions in this game for owner' });
      const result = db.prepare('DELETE FROM response_cache WHERE game_id = ?').run(gameId);
      return reply.send({ deleted: result.changes });
    });
    ```

12. **Proxy route**: `server/src/routes/chat.ts` — register `/api/chat/debug/cache` →
    chat-service `DELETE /debug/cache`. Mirror existing `/api/chat/debug/*` pattern.

13. **Consumer wiring for the two FE-only toggles**:
    - `showDebugLinks`: chat header (existing component, search for chat session header
      render) shows/hides a `<Link>` to `/dev/chat-audit/:sessionId` based on the flag.
    - `rawEventsDefaultExpanded`: `src/pages/DevAudit/raw-events-accordion.tsx` uses
      `useChatServiceSettings()` (or its non-hook helper) to set initial expanded state.

14. **Tests**:
    - `use-chat-service-settings.test.ts` — defaults, patch merge, debounced write,
      corrupt-JSON fallback.
    - `turn-model-header.test.ts` — allowlisted X-Model honored; non-allowlisted
      silently dropped; missing header → default.
    - `debug-cache-clear.test.ts` — owner with no sessions in game → 403; with sessions
      → row count returned; missing `?game=` → 400.

## Todo List

- [x] Settings hook (`use-chat-service-settings.ts`) + tests
- [x] Tab panel (`chat-service-tab.tsx`) + register in settings-page.tsx
- [x] Model select + cache controls + two toggles (sub-components)
- [x] FE client header attachment
- [x] BE: `resolveModel` helper + `config.allowedModels` + tests
- [x] BE: bypass-cache header read in `/turn`
- [x] BE: `DELETE /debug/cache` route + ownership guard + tests
- [x] Proxy route in `server/src/routes/chat.ts`
- [x] FE consumers of `showDebugLinks` + `rawEventsDefaultExpanded`
- [x] Manual smoke: set each toggle, verify behavior; clear cache → toast shows count

## Success Criteria

- `/settings` shows a "Chat Service" tab with all 5 controls
- Selecting a model and posting a chat → `/dev/chat-audit/<sessionId>` turn header shows
  the chosen model (not server default)
- Bypass-cache toggle + post identical query twice → both turns have no `cache_hit`
  badge (phase 06 set), per-call llm_calls rows exist in both
- Clear-cache button → toast confirms deletion, posting same query thereafter is a fresh
  LLM call
- Show-debug-links toggle on → chat page header shows "Debug" link to chat-audit
- Raw-SDK-events default-expanded toggle on → `/dev/chat-audit/<sessionId>` opens with
  raw events visible without an extra click

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| User sets `X-Model` to a non-allowlisted value and bypasses | M | M | BE allowlist via `config.allowedModels`; unknown → fallback silently |
| "Clear my cache" wipes shared cache for other owners in same game | H | M | Confirm dialog explains the scope; toast shows count; logged for audit |
| localStorage corruption breaks settings page | L | L | Hook returns defaults on JSON parse failure; never throws |
| Bypass-cache leaves cache poisoned by a half-completed turn | L | M | Bypass is symmetric: both read AND write are skipped when header is set |
| Default-model selector confused with system-prompt selection | M | L | Hint text below select clarifies what it does |
| `DELETE /debug/cache` becomes a vector for cache thrashing | L | L | Rate-limited (1/sec per owner) via existing rate-limit middleware pattern |

## Security Considerations

- Owner-scoped DELETE — owner must have at least one session in the target game.
- Model allowlist enforced server-side — never accept arbitrary model strings.
- localStorage NOT used for any secret or PII; pure UI/runtime preference.
- Cache-bypass header does NOT change ownership rules — turn still owner-scoped.
- Confirm dialog before destructive cache clear; toast shows what was deleted.

## Next Steps

- Future: per-URL model override (e.g., `/chat/:id?model=haiku`) for one-off
  comparison sessions.
- Future: org-level admin view to clear cache across games (not in scope).

## Unresolved Questions

- Should "Show debug links" also surface a link from main app to `/dev/chat-audit`? For
  now, only the per-chat-session "Debug this chat" link is in scope.
