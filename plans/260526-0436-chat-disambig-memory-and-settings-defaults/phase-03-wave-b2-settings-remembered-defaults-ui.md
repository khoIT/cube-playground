# Phase 03 — Wave B2: Settings → Chat "Remembered defaults" UI + API

## Context Links

- Brainstorm: `plans/reports/brainstorm-260526-0436-chat-disambig-memory-and-settings-defaults.md`
- Depends on phase 02 (`user-prefs-adapter.ts` + table exist).
- Settings tab: `src/pages/Settings/chat-preferences-section.tsx`
- Design tokens (mandatory): `docs/design-guidelines.md`, `src/theme/tokens.css`
- Existing SectionCard pattern: `src/pages/Settings/section-card.tsx`
- Existing API style (Fastify): `chat-service/src/api/health.ts`, `chat-service/src/api/notifications.ts`
- Index registration: `chat-service/src/index.ts:65-78`
- Cube meta cache: `chat-service/src/core/cube-meta-cache.ts`
- Existing hook pattern: `src/pages/Settings/use-chat-disambiguation-mode.ts`

## Overview

- **Priority:** P2 (depends on phase 2, user-visible surface)
- **Status:** pending
- **Description:** Three new HTTP routes under `/api/chat/user-prefs` + a second SectionCard in Settings → Chat that lists rows, supports per-row delete and "Clear all". Backend resolves cube-member labels server-side (avoid FE meta round-trip).

## Key Insights

- Two stacked SectionCards in existing Chat tab — append, do not nest.
- Backend resolves labels (metric ref → "ARPDAU") via `cube-meta-cache.ts` (already warm). FE just renders strings.
- Phrase preferred over value for timeRange display; value preferred for metric/dimension/filter (canonical labels are more useful than user's phrasing like "revenue").
- Empty state required (most users start with zero remembered defaults).
- All visual styling uses CSS vars from `tokens.css`. No inline hex or px font sizes.
- Tests use vitest + RTL; backend tests use `:memory:` SQLite.

## Requirements

### Functional

- `GET    /api/chat/user-prefs?gameId=<id>` → `200 [{ slot, value, phrase?, label, lastUsedAt, hitCount }]`. Owner from auth context (same source as other chat routes). Sorted by `lastUsedAt DESC`.
- `DELETE /api/chat/user-prefs/:slot?gameId=<id>` → `204`. Slot path-param URL-encoded for `filter:<member>`.
- `DELETE /api/chat/user-prefs?gameId=<id>`     → `204`. Clears all rows for owner+game.
- `label` resolved server-side: metric/dimension via `cube-meta-cache.extractMemberNames` + meta `shortTitle`. For `filter:<member>` label = `"Filter (<member-shortTitle>)"`. For `timeRange` label = phrase if present, else dateRange formatted as `YYYY-MM-DD → YYYY-MM-DD`.
- FE: second SectionCard titled "Remembered defaults" with hint "Slots the chat assistant has learned from your past sessions." Shows table-style rows: slot label, value/phrase, "last used N ago", `×` button.
- "Clear all remembered defaults" button below the list (destructive style via `--destructive-soft / --destructive-ink`).
- Empty state copy: "No remembered defaults yet. The chat assistant will learn as you confirm choices in chat."
- `×` triggers DELETE then refetches list.
- Confirm-prompt on "Clear all" (browser `confirm()` is fine; KISS).
- i18n keys: `settings.chat.rememberedDefaults.title / subtitle / empty / clearAll / lastUsed / slot.metric / slot.dimension / slot.timeRange / slot.filter`. English + Vietnamese.

### Non-functional

- BE route file ≤ 200 LOC. FE component files each ≤ 200 LOC.
- Use `var(--font-sans)` only. Use spacing scale (8 / 12 / 16 / 24).
- Backend label resolution adds one cube /meta lookup (already cached); no FE meta fetch.
- TS strict; no `any`.

## Architecture

```
FE (src/pages/Settings):
  chat-preferences-section.tsx
    └─ SectionCard #1: existing disambiguation mode radio
    └─ SectionCard #2: <ChatRememberedDefaultsList />          (new)
                          ├─ uses useChatRememberedDefaults()  (new hook)
                          │      ├─ GET  /api/chat/user-prefs?gameId
                          │      ├─ DELETE /api/chat/user-prefs/:slot
                          │      └─ DELETE /api/chat/user-prefs (all)
                          ├─ renders rows + × per row
                          ├─ renders "Clear all" button
                          └─ renders empty state

BE (chat-service/src/api):
  chat-user-prefs.ts (new Fastify plugin)
    ├─ GET    /api/chat/user-prefs       → getUserPrefs + label-resolve via cube-meta-cache
    ├─ DELETE /api/chat/user-prefs/:slot → deleteUserPref
    └─ DELETE /api/chat/user-prefs       → deleteAllUserPrefs
```

## Related Code Files

**Modify:**
- `chat-service/src/index.ts` (register new route plugin).
- `src/pages/Settings/chat-preferences-section.tsx` (append second SectionCard).
- `src/i18n/en/settings.json` and `src/i18n/vi/settings.json` (or wherever existing chat keys live — grep `settings.chat.mode` first).

**Create:**
- `chat-service/src/api/chat-user-prefs.ts` (Fastify route plugin).
- `chat-service/src/api/chat-user-prefs-labels.ts` (label-resolver helper; keeps route file lean).
- `chat-service/test/api/chat-user-prefs.test.ts` (route integration with `:memory:` DB).
- `src/pages/Settings/use-chat-remembered-defaults.ts` (fetch + mutate hook).
- `src/pages/Settings/chat-remembered-defaults-list.tsx` (list + empty state).
- `src/pages/Settings/__tests__/chat-remembered-defaults-list.test.tsx` (RTL).

**Delete:** none.

## Implementation Steps

1. **BE label resolver helper.** `chat-user-prefs-labels.ts` exports `resolveLabel(slot, value, phrase, meta) → string`. Uses `cube-meta-cache.extractMemberNames(meta)` and meta `shortTitle`. Bilingual support deferred (label is canonical English from cube /meta).
2. **BE route plugin.** `chat-user-prefs.ts` registers 3 routes under Fastify, accepting `gameId` query param, deriving `ownerId` from request context (same pattern as `sessionsRoutes`). GET calls `getUserPrefs(db, ownerId, gameId)` + `resolveLabel` per row; sorts by `lastUsedAt DESC`. DELETE routes call adapter. Return 404 on slot delete miss.
3. **Wire route plugin.** Register `chatUserPrefsRoutes` in `chat-service/src/index.ts` after `notificationsRoutes`.
4. **FE hook.** `use-chat-remembered-defaults.ts` follows the pattern of `use-chat-disambiguation-mode.ts`. Exposes `{ rows, loading, error, refresh, removeOne(slot), removeAll() }`. Uses `gameId` from existing settings context.
5. **FE list component.** `chat-remembered-defaults-list.tsx`:
   - Reads tokens via `var(--text-primary)`, `var(--bg-card)`, `var(--border-card)`, `var(--radius-md)`, `var(--font-sans)`.
   - Row layout: `display: grid; grid-template-columns: 140px 1fr auto auto;` for label / value / last-used / × button. Gap 16. Padding 12.
   - Last-used: render via existing relative-time util if one exists (grep `formatRelative` or `formatTimeAgo`); otherwise format with `Intl.RelativeTimeFormat`.
   - × button: `var(--destructive-ink)` on hover, otherwise muted; aria-label `Remove <slot label>`.
   - "Clear all" button at bottom: destructive soft surface; `confirm()` before firing DELETE.
   - Empty state: centered hint paragraph.
6. **Append SectionCard.** In `chat-preferences-section.tsx`, return `<>` fragment with the existing SectionCard PLUS a new SectionCard whose body is `<ChatRememberedDefaultsList />`. SectionHead has Title + Hint per existing pattern.
7. **i18n keys.** Add en + vi values:
   - `settings.chat.rememberedDefaults.title: "Remembered defaults"`
   - `.subtitle: "Slots the chat assistant has learned from your past sessions."`
   - `.empty: "No remembered defaults yet. The chat assistant will learn as you confirm choices in chat."`
   - `.clearAll: "Clear all remembered defaults"`
   - `.lastUsed: "last used {{when}}"`
   - `.slot.metric / .dimension / .timeRange: "Metric" / "Time range" / "Dimension"`
   - `.slot.filter: "Filter ({{member}})"`
8. **Tests.**
   - BE: `:memory:` DB; insert 2 owners' rows; GET as owner A returns only A's rows. DELETE a slot → row gone. DELETE-all → empty. Bad gameId → 400.
   - FE: mock fetch; renders 3 rows; click × on row 0 → DELETE called → re-fetch → 2 rows. Empty state on initial 0 rows. Click "Clear all" → confirm dialog → DELETE all → list empty.
9. **Visual cross-check.** Pull up Dashboards page and Cohort page side-by-side; verify typography, padding, border-radius match. No bespoke shadow / radius / color.
10. **Compile + run.** All previous tests still green.

## Todo List

- [ ] BE: `chat-user-prefs-labels.ts` helper
- [ ] BE: `chat-user-prefs.ts` Fastify plugin (GET + 2 DELETEs)
- [ ] BE: register plugin in `index.ts`
- [ ] BE: route integration tests with `:memory:` DB
- [ ] FE: `use-chat-remembered-defaults.ts` hook
- [ ] FE: `chat-remembered-defaults-list.tsx` component
- [ ] FE: append second SectionCard in `chat-preferences-section.tsx`
- [ ] i18n keys (en + vi)
- [ ] FE RTL tests (rows, delete, clear-all, empty state)
- [ ] Visual cross-check against Dashboards + Cohort pages
- [ ] Commit: `feat(settings): chat remembered defaults panel + user-prefs API`

## Success Criteria

- Settings → Chat tab shows two SectionCards stacked; second lists remembered defaults.
- × on a row → DELETE 204 → row disappears.
- "Clear all" with confirm → DELETE all 204 → empty state shown.
- Empty state visible when zero rows.
- No raw hex / px-font literals in new FE files (grep enforces).
- Backend route file ≤ 200 LOC; FE component ≤ 200 LOC.
- Phase-02 and phase-01 tests still green.

## Risk Assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Cube meta cache cold on first request | Low | Low | `cube-meta-cache.getMeta` already handles cold + warms on demand; same path used by disambig tool. |
| 2 | Filter slot key with `:` breaks URL path param | Med | Low | URL-encode slot in FE; `decodeURIComponent` on BE. Add a test fixture for filter row delete. |
| 3 | i18n keys missing for `vi` cause English fallback in production | Low | Low | Pass `defaultValue` for every key (existing pattern in `chat-preferences-section.tsx`). |
| 4 | Visual drift from existing Settings styling | Med | Med | Mandatory cross-check step #9; use existing `SectionCard / SectionHead / SectionTitle / SectionHint` primitives only. |
| 5 | Owner derivation mismatch with other routes | Low | Med | Copy auth shape from `sessionsRoutes` exactly. Test asserts per-owner isolation. |
| 6 | Race between delete and refetch leaves stale row visible | Low | Low | `removeOne` awaits DELETE then awaits refresh; disable × button while in-flight. |
| 7 | Confirmation via `confirm()` rejected by design as too bland | Low | Low | KISS for v1; native confirm is acceptable. Replace with custom modal only if user pushes back. |

## Security Considerations

- All routes derive `ownerId` from request context, never from query/body. Adapter requires `ownerId` as positional param.
- DELETE routes do not echo the deleted body; 204 only.
- No raw SQL on inputs; adapter uses prepared statements.
- Label resolution uses cube-meta-cache; no untrusted strings rendered without escaping (React handles).
- Document in `docs/system-architecture.md` that `user_disambig_prefs` is owner-scoped and tied to the same multi-user review gate as `response_cache` wave-2.

## Next Steps

- Phase 4 independent and may have already landed.
- After ship, monitor: are users clearing rows often? If so, indicates the disambig writes are too aggressive — revisit confidence gate.
