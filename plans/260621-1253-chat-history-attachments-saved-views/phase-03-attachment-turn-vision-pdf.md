# Phase 03 — Attachment in chat turn: image→vision, PDF/doc→text

**Priority:** High. **Effort:** M. **Status:** pending. **Depends on:** Phase 02.

## Overview
Let a chat turn carry attachments. Images feed the model via vision; PDF/doc extracted text is injected as turn context. Composer gets a paperclip; the turn body references attachment ids; the runner builds multimodal/contextual input.

## Key insights (verified + to-verify)
- SDK = `@anthropic-ai/claude-agent-sdk@0.3.150`. Today `query({ prompt: string })` (`claude-runner.ts:~326`). **Must spike**: the SDK's `prompt` also accepts an `AsyncIterable<SDKUserMessage>` (streaming-input mode) whose `message.content` can include `{type:'image', source:{type:'base64',...}}` blocks. If that works on 0.3.150 → native vision.
- **Fallback if streaming-input images unsupported**: server-side describe image via Gemini `ai-multimodal` (or Claude vision direct API call outside the agent SDK) → inject the description as text context. Degrade gracefully; never hard-fail the turn.
- Default model is Sonnet (vision-capable); gateway key is sonnet-only (fine for vision). Verify routed model is vision-capable before sending image blocks; else use fallback.
- `context` field on the turn body is already extensible (`turn.ts:61-76`) and flows into the composed system prompt (`turn.ts:339-349`) — the injection point for attachment metadata + extracted text.

## Requirements
- Turn body: add `attachment_ids?: string[]` (validated, owner-scoped, belong to session/owner).
- Runner: for each attachment —
  - image → include as vision content block (streaming-input) OR fallback description text.
  - pdf/doc → inject `extracted_text` into prompt context under an `## Attachments` section (filename + text, capped).
  - csv → NOT handled here (Phase 04 routes it to segment import; if a csv is attached to a normal turn, inject a short summary only).
- FE composer: paperclip → file picker → upload (Phase 02 route) → show attachment chips above textarea with kind icon + filename + remove; on submit, pass `attachment_ids`. Pending-upload state disables submit.
- Render attachments on the user turn bubble (thumbnail for image, file pill for pdf).
- Parity: works in both panel composer (`compact`) and full-page composer.
- Persist: store attachment refs on the turn (extend `chat_turns` or join table) so reloading a session shows them.

## Architecture / related files
- Modify: `chat-service/src/api/turn.ts` (schema `attachment_ids`; load rows; pass to runner; weave extracted text into `compose()`).
- Modify: `chat-service/src/agent/claude-runner.ts` (accept `messageBlocks`/attachment inputs; build streaming-input user message when images present; else string prompt).
- Modify: prompt composition (`mode-prompts.ts`) — add `## Attachments` section builder.
- Create (spike): `chat-service/src/agent/vision-input.ts` — decides native-vision vs Gemini-fallback; produces content blocks or description text.
- FE modify: `src/pages/Chat/components/chat-composer.tsx` (paperclip, upload, chips, pending state), turn-bubble renderer for attachments.
- FE create: `src/pages/Chat/hooks/use-attachment-upload.ts`.

## Implementation steps
1. **Spike first** (timeboxed): can 0.3.150 take streaming-input `SDKUserMessage` with image blocks? Record result in this file. Pick native-vision or Gemini-fallback path.
2. Runner: branch — images present → streaming-input message with text + image blocks (or fallback text); else current string prompt. Keep tool loop unchanged.
3. turn.ts: validate + load attachments (owner/session scope); build extracted-text context; pass image refs to runner.
4. Composer: upload-on-select via `use-attachment-upload`; chips; block submit while uploading; pass ids on submit.
5. Turn bubble: render image thumbnail (GET route) + pdf/doc pill.
6. Persist refs on turn; rehydrate on session load.

## Todo
- [ ] SDK vision spike + decision recorded
- [ ] runner multimodal/fallback path
- [ ] turn.ts schema + attachment load + prompt injection
- [ ] composer paperclip + chips + pending-submit guard (both surfaces)
- [ ] user-bubble attachment render + rehydrate
- [ ] tests: image turn (mocked vision), pdf-text turn, oversized rejection upstream, rehydrate shows attachments

## Success criteria
- Attach a chart screenshot + ask "what stands out?" → model answers about the image (native or via fallback description).
- Attach a PDF brief → model uses its text. Attachments persist on reload. Works in panel + full page.

## Risks
- SDK surface uncertainty → spike gates approach; fallback guarantees a shippable path.
- Token blowup from large extracted text → hard cap + note truncation in the injected section.
- Non-vision model routed → detect + fallback, don't send image blocks blindly.
