# POC Recommendations — Data Exploration & Segment Creation

Audience lens: **business leaders + liveops with little time**. Goal: most impressive POC. Scope: data exploration + segment creation only.

## TL;DR — what to build, ranked

| # | Build | Effort | Why it impresses time-poor leaders | Reuses |
|---|-------|--------|-------------------------------------|--------|
| 1 | **Chat History in panel header** (your idea #1) | S (UI wiring) | Continuity — come back, find your thread | `GET /api/chat/sessions?q=` + `useChatSessionsList` already exist |
| 2 | **Proactive Daily Brief** (signature) | M | Data comes to *them*; no typing | advisor `diagnose` + chat narration + cron |
| 3 | **Attachments, reframed** (your idea #2) | M | "Drop a cohort list → instant monitored segment"; "drop a chart → explain it" | `uid_list_json` segment path; needs new multipart route |
| 4 | **"Ask why" on every KPI tile / chart** | S | Turns passive dashboards into a conversation | panel + seeded message both exist |
| 5 | **Shareable one-page insight brief / export** | M | They leave with a takeaway | `chat_turns` artifacts/charts JSON |

Refactors: server-persist Saved Views (today localStorage-only); close chat panel↔page parity gap.

---

## Key finding that reframes idea #1

**Chat history is ~90% already built.** Backend has `chat_sessions` + `chat_turns` tables (`chat-service/src/db/schema.sql:2–40`), a listing endpoint `GET /api/chat/sessions?game=&q=` with search, and a frontend hook `useChatSessionsList()` already consumed by the sidebar tray.

The right-side panel header (`src/shell/chat-overlay/chat-panel-header.tsx`) today exposes only: Title→expand, mode chip, **New (+)**, **Close (X)**. It has **no History affordance**.

So the Cube-Cloud-style "History / New Chat" you screenshotted is a **thin UI add**: drop a History button + searchable dropdown into the panel header, list via the existing endpoint, switch via `setActiveChatSession(id)` (already the panel's session mechanism, `chat-panel.tsx:62–67,115–123`). New Chat already works. This is the cheapest high-visibility win.

---

## Recommendations in detail

### 1. Chat History in panel header — S
- Add `History` button to `chat-panel-header.tsx`; popover with search input + recent-sessions list (reuse `useChatSessionsList(gameId, q)`).
- Select → `setActiveChatSession(id)`; `usePanelChatState` already hydrates from DB on id change.
- Mirror the screenshot: search box on top, titled rows below. ~1 component + header slot.

### 2. Proactive Daily Brief — M  *(the centerpiece)*
Time-poor leaders want **push, not pull**. A scheduled, per-game narrative: *"Revenue −8% WoW, concentrated in returning-payer cohort; segment X churn rising; 2 items need attention."*
- Generate via the existing `diagnose` skill against top KPIs on a cron; store as a special "brief" turn/session so it lands in the same History rail.
- Surface as a card on `/ops-console` and as the panel's empty-state ("Here's today's brief").
- This is the single most differentiating feature for the stated audience — it's the "data explains itself" demo moment.

### 3. Attachments — M  *(your idea #2, reframed for this audience)*
Today: turn body is **text-only**, no multipart, no blob storage (`chat-service/src/api/turn.ts`, schema). Net-new plumbing required. Reframe by value:
- **(a) Cohort-list upload/paste → instant segment.** Liveops drops 500 uids (CSV/paste) → create a `uid_list` segment immediately monitored (Monitor/Movement/Care tabs light up). Reuses the existing `uid_list_json` segment path — *highest liveops value, smallest data surface (tiny text)*. Start here.
- **(b) Image attach → "explain this chart/screenshot."** Leader drops a dashboard screenshot → vision model interprets → seeds a chat turn. Use Claude vision or the `ai-multimodal` (Gemini) path. Phase 2; needs base64/multipart + a vision branch in the runner.
- Add a multipart route + minimal blob handling (or inline base64 for images; uid lists stay text). Composer paperclip already implied by the screenshot.

### 4. "Ask why" on every KPI tile & chart — S
Every Ops/Dashboard tile gets an "Ask why ↗" that opens the panel pre-seeded with a `diagnose` turn scoped to that metric+filter. Panel + seeded-message both exist; this is mostly wiring. Converts static dashboards into live conversation — big perceived intelligence, low effort.

### 5. Shareable one-page insight brief / export — M
Leaders want a takeaway. Turn a chat thread (or a segment's monitor view) into a one-page HTML/PDF brief with the narrative + key charts. Artifacts already persist in `chat_turns.charts_json/artifacts_json`. Pairs naturally with #2 (brief → share link).

---

## Refactors worth doing for the POC

- **Saved Views → server persistence.** Today localStorage-only (`Catalog/saved-views/`). A leader saving an exploration on one machine and losing it on another is a bad demo moment. Promote to a small server table (mirror dashboards tiles).
- **Chat panel↔page parity.** Renderer is shared, but feature flags diverge (panel historically hid follow-up chips / refine row). The panel is what leaders see most — keep features at parity or the panel feels second-class.
- **Demo resilience / empty states.** The screenshot shows the *competitor* product failing ("Unable to load schemas… timeout", "Failed to query semantic model"). Our equivalent failure modes (cold Trino 3.5–15s, empty data ranges) must degrade gracefully in a demo — loading skeletons + the existing empty-range re-anchor, not red errors.

---

## Suggested POC sequence
1. Chat History panel (S) — closes the visible Cube-Cloud gap immediately.
2. "Ask why" tiles (S) — cheap, makes the whole app feel intelligent.
3. Cohort-list-upload segment (attachments part a, M) — concrete liveops value.
4. Daily Brief (M) — the headline feature for leadership.
5. Shareable brief + image attach + Saved Views server-persist — polish round.

## Open questions
1. Daily Brief delivery — in-app only, or also email/Slack? (changes scope of #2)
2. Attachments: confirm starting with cohort-list-upload (text) vs leading with image-to-insight (vision plumbing)?
3. Is the demo audience VNGGames-internal only (VPN/AUTH_DISABLED), or will external leaders see it? (affects auth + share-link design)
