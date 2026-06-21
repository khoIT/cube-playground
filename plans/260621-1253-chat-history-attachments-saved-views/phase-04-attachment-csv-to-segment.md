# Phase 04 — Attachment CSV/uid-list → instant segment

**Priority:** High (top liveops value, small surface). **Effort:** S. **Status:** pending. **Depends on:** Phase 02 (composer upload affordance only).

## Overview
When a user attaches/pastes a CSV or uid list in chat, offer to create a `manual` segment instantly. Backend is already built — this is mostly FE wiring + a confirmation card. The model is not involved in the import path.

## Key insights (verified)
- `POST /api/segments/import-ids` (`server/src/routes/segments.ts:1047-1133`) accepts raw ids → creates `manual` segment.
- `server/src/services/csv-importer.ts` parses (header detect `user_id|uid|id|customer_id|player_id`, dedupe, reject >256-char rows, 5k cap) → `{ uids, errors, truncated }`.
- `manual` segments skip refresh (`jobs/refresh-segment.ts:91`) + snapshot (`jobs/snapshot-segment-membership.ts:122`) → instant, no queue.
- Monitor/Care/Members tabs already serve `type='manual'`; `/members` falls back to `uid_list_json`.
- `POST /api/segments/:id/append` merges+dedupes for "add more uids".

## Requirements
- Composer detects csv/plain attachment (or a pasted block that looks like ids) → shows an inline **"Create segment from N ids"** action instead of sending to the LLM.
- Confirmation card (reuse/mirror `segment-proposal-card.tsx`): editable name, cube selector (needed for Care/identity), visibility (personal default), parsed preview (count, dupes removed, errors, truncated warning).
- Confirm → `POST /api/segments/import-ids`; on success, emit a chat system bubble with a link to the new segment detail; toast.
- Show parser errors/truncation honestly (no silent drop).
- Decision: parse client-side for preview but **authoritative parse server-side** (import-ids already parses) — avoid divergence; FE preview can call a dry-run or just count lines.

## Architecture / related files
- FE create: `src/pages/Chat/components/csv-segment-card.tsx` (preview + name/cube/visibility + create).
- FE modify: `chat-composer.tsx` / attachment handling — route csv kind to this card path, not the turn.
- Reuse: segment create client (`POST /api/segments/import-ids`), cube selector component from the builder, `segment-proposal-card.tsx` styling.
- BE: likely no change. If a server-side dry-run preview is wanted, add `POST /api/segments/import-ids?dryRun=1` returning parser result without insert (optional, small).

## Implementation steps
1. Composer: when attachment kind = csv/plain (or paste heuristic), surface "Create segment" affordance + open `csv-segment-card`.
2. Card: load cube list; show parsed preview (line/id count; if dry-run endpoint added, show errors/dupes/truncation precisely); name + visibility.
3. Confirm → call import-ids with `{ name, cube, visibility, ids|raw_text }`; handle truncated/error response.
4. Success → chat bubble + link to `/segments/:id`; offer "monitor now" (opens Monitor tab).
5. Edge: empty/garbage input → friendly error; >5k → state cap applied.

## Todo
- [ ] composer routes csv kind to segment path (not LLM turn)
- [ ] `csv-segment-card` with preview + cube + visibility + create
- [ ] (optional) `?dryRun=1` on import-ids for accurate preview
- [ ] success bubble + segment link + monitor CTA
- [ ] tests: paste/upload ids → segment created, dupes/truncation surfaced, manual segment monitorable

## Success criteria
- Liveops pastes 500 uids in chat → confirm card → one click → `manual` segment exists and its Monitor/Members tabs work immediately.

## Risks
- Cube required for Care/identity enrichment — make cube selection clear; default sensibly per active game.
- Don't double-parse divergently FE vs BE — server is authoritative.
- Heuristic for "paste looks like ids" must not hijack normal questions — only trigger on explicit attach or an obvious id block + explicit user action.
