---
phase: 5
title: "Provenance pipeline: sources[] schema + per-block UI chips"
status: pending
priority: P2
effort: "1.5d"
dependencies: [2, 3, 4]
---

# Phase 5: Provenance pipeline — `sources[]` schema + per-block UI chips

## Overview
Make provenance a first-class field on every assistant turn: skill prompts emit it, the
chat-service stores it, the frontend renders per-block source chips. This is the user-facing
artifact that proves the source-of-truth policy.

## Architecture
- **Wire format** — assistant response includes a structured `blocks[]` (already streamed
  via SSE) plus a new `sources[]`. Each source: `{ id, tool, callId, kind: 'cube' | 'web' |
  'atlassian' | 'files' | 'meta', label?, url?, refId? }`. Each `block` references one or
  more `sources[].id`. Skill prompts produce this in the response envelope (the runner is
  already responsible for parsing the SDK output; extend the parser to surface `sources`).
- **DB schema** — new column `sources_json TEXT` on `chat_turns` via migration in
  `chat-service/src/db/migrate.ts` (idempotent `addColumnIfMissing`). Store the array as
  JSON for replay/audit.
- **SSE event** — add `sources` event interleaved with `block` events so the frontend can
  attach chips as text streams in. Reuse existing observer/streamer scaffold.
- **Frontend `SourceChip` component** (`src/shell/chat-overlay/source-chip.tsx`):
  - Inline pill: icon + short label (e.g. `📊 ballistar_active_daily`).
  - Click → expanded popover with full citation (Cube member name + filters / URL / Jira
    key). For Cube sources, link to the relevant artifact card.
  - Tokens: reuse `--success-soft` (Cube), `--info-soft` (web), `--warning-soft` (atlassian),
    `--muted-soft` (files) — per design-guidelines.
- **Block renderer** — extend the existing chat block renderer to look up each block's
  `sources[]` and render chips at the end of the block.
- **Audit UI** — chat-audit detail page reads `sources_json` and renders the same chips so
  reviewers see provenance at a glance.

## Related Code Files
- Modify: `chat-service/src/db/schema.sql` + `migrate.ts` (add `sources_json`),
  `chat-service/src/db/chat-store.ts` (persist + return),
  `chat-service/src/core/claude-runner.ts` or stream parser (parse + emit sources),
  `chat-service/src/api/turn.ts` (forward SSE event)
- Create: `src/shell/chat-overlay/source-chip.tsx`,
  `src/shell/chat-overlay/source-popover.tsx`
- Modify: chat block renderer in `src/shell/chat-overlay/`,
  chat-audit turn detail page

## Implementation Steps
1. Add `sources_json` column + persist in `chat-store`.
2. Define TypeScript types for the wire shape (shared between chat-service + frontend).
3. Extend SDK output parser to capture `sources[]` from the model's structured output
   (instruct in skill prompts: each turn ends with a fenced JSON sources block).
4. Emit `sources` SSE event; frontend buffers them and pairs to blocks.
5. Build `SourceChip` + popover; render at end of each block.
6. Audit detail page: pull `sources_json`, render the same chips + tool-call breakdown.

## Success Criteria
- [ ] Data turn shows 📊 Cube chips on the artifact block.
- [ ] Hybrid turn shows 📊 Cube on the data block and 🌐/🗂 on the "Context (not data)" block.
- [ ] Research turn shows only enrichment chips, no Cube.
- [ ] `chat_turns.sources_json` populated for new turns; audit UI shows chips.

## Risk Assessment
- **Model fails to emit sources block** — fallback: infer minimum sources from
  `tool_calls_json` (one chip per tool call type). Mitigation: provenance instructions in
  skill prompts + lint check on prompt updates.
- **UI noise** — too many chips per block. Mitigation: dedupe by tool kind; show count if
  > 3 of same kind.
- **Backfill** — existing turns have no sources; show "legacy turn" badge in audit UI.
