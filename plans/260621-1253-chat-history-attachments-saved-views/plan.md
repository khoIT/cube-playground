# Plan — Chat History Panel + Attachments + Saved Views Refactor

Scope: data exploration + segment creation. Audience: business leaders + liveops.
Branch: main (commit directly per project convention). Stack: React FE + chat-service (Fastify+SDK) + server (Fastify+SQLite).

## Phases

| # | Phase | Effort | Depends on | Status |
|---|-------|--------|-----------|--------|
| 01 | [Chat History in panel header](phase-01-chat-history-panel.md) | S | — | pending |
| 02 | [Attachment backend: upload route + disk blob store](phase-02-attachment-backend-storage.md) | M | — | pending |
| 03 | [Attachment in chat turn: image→vision, PDF/doc→text](phase-03-attachment-turn-vision-pdf.md) | M | 02 | pending |
| 04 | [Attachment CSV/uid-list → instant segment](phase-04-attachment-csv-to-segment.md) | S | 02 (composer UI) | pending |
| 05 | [Saved Views refactor: wire Save action + capture query state](phase-05-saved-views-refactor.md) | M | — | pending |

Recommended ship order: 01 → 04 → 02/03 → 05. (01 is nearly free and visible; 04 reuses an existing backend; 02/03 is the real net-new plumbing; 05 is independent polish.)

## Key insights (verified)

- **Chat history is mostly built.** `chat_sessions`/`chat_turns` tables, `GET /api/chat/sessions?game=&q=` (searchable), and `useChatSessionsList()` already exist. Panel header (`chat-panel-header.tsx`) lacks only a History affordance. New Chat already wired (`chat-panel.tsx:115`).
- **CSV→segment backend exists.** `POST /api/segments/import-ids` + `server/src/services/csv-importer.ts` (header detect, dedupe, 5k cap) + `manual` segment type. Manual segments skip refresh/snapshot jobs → instant + monitored. Monitor/Care/Members tabs already serve `type='manual'`.
- **Attachments need real backend plumbing.** Turn body is text-only; no multipart, no blob storage. SDK = `@anthropic-ai/claude-agent-sdk@0.3.150`; `query()` prompt is a string today. Vision path requires streaming-input mode (SDKUserMessage with image content blocks) — must be spiked (Phase 03) with a Gemini-vision-to-text fallback.
- **Saved Views already server-backed** via `user_prefs` table; gap is the un-wired Save action + route-only (no query state) capture, not storage.

## Locked decisions (from user)
- Attachments: images→vision, CSV/uid-list→segment, PDF/doc→text. (Not generic file-attach.)
- Storage: local disk blob store + SQLite metadata.
- Saved Views: reframed to "wire Save action + capture query state" (storage already server-side).

## Cross-cutting
- Design tokens only (`docs/design-guidelines.md`); mirror existing page-header / panel patterns.
- Chat features must reach BOTH surfaces (main `/chat` + right panel) — parity is a known trap.
- Tests: each phase ships unit/integration; no skipped tests to pass build.

## Open questions
1. Saved Views — confirm reframed scope (wire Save + capture Cube query state) vs leave route-only. Add per-view atomic delete (own table) or keep blob-in-user-prefs?
2. PDF extraction lib choice (pdf-parse vs pdfjs) — any license constraint?
3. Image vision: acceptable to fall back to Gemini `ai-multimodal` describe-to-text if SDK streaming-input image blocks don't work on 0.3.150?
4. Attachment size/type caps + retention (auto-purge with session tombstone?).
