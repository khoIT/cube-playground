# Phase 02 — Verdict Field + Prompt Hardening (fixes 1–2)

Priority: **High** (top user value) · Status: **DONE** (committed 8c9b1980; live-verified) · Stack: Full-stack.

**Live eval (subscription lane, host :3005):** direct data answer → verdict+artifact, no
clarify; specific analytical judgment → verdict+artifact; vague "numbers" → clarify, no
verdict. All three PASS. Cache parity is unit-verified (replay-artifacts.test.ts).

## Overview

Add a structured `verdict` (headline takeaway + short rationale) that flows
agent → SSE → DB → history load → renderer. The turn leads with the verdict;
charts become supporting evidence. Same change harden the prompt so the agent
stops leaking meta-narration (the "Task tracking isn't relevant here…" body text)
— that was fix 2, and it's a prompt problem, not a renderer toggle.

Mirrors the existing `propose_segment` / `emit_query_artifact` precedent exactly.

## Context links

- Plan: [plan.md](plan.md)
- Scout map: turn.ts, chat-store.ts, sessions.ts, types.ts, sse-stream.ts,
  migrate.ts, cube-playground.md + skills

## Key insights (from scout)

- Structured-field flow precedent (`proposals`): tool emits SSE event → captured
  on `sseEmitter` in `turn.ts:440–443` → `appendTurn` serializes to
  `proposals_json` (`chat-store.ts:360`) → `rowToTurn` deserializes
  (`sessions.ts:85–87`) → `TurnDto.proposals`.
- `disambig_json` follows the same path (`turn.ts:436`, `:717`; `sessions.ts:83`).
- SSE event union: `chat-service/src/types.ts:72–244`. Result event `:110–127`.
- DB row type `ChatTurnRow`: `types.ts:329–380`. Migrations via
  `addColumnIfMissing` in `db/migrate.ts` (~line 91, idempotent ALTER).
- `QueryArtifact.summary` (`types.ts:44–66`) = precedent for a model-authored
  one-sentence structured string emitted via tool input.
- Skills live in `chat-service/.claude/skills/{explore,diagnose,advise,compare,
  segment,metric_explain}/` + master command `cube-playground.md`.

## Requirements

### Verdict schema
```ts
interface VerdictData { headline: string; rationale?: string }
```
- `headline`: one sentence, the answer/takeaway (≤ ~90 chars).
- `rationale`: optional 1–2 sentences (≤ ~280 chars).
- Status tags from mockup = OUT of scope.

### Backend — verdict end-to-end (mirror `proposals`)
1. **Type** — add `verdict` to SSE event union + `verdict_json` to `ChatTurnRow`
   (`types.ts`).
2. **Tool** — `emit_verdict({ headline, rationale? })`, new tool file; emits
   `{ type: 'verdict', data }` SSE event. Follow `emit_query_artifact` shape.
   **RED-TEAM: registration is 4 places, and order matters — the boot-guard
   CRASHES the service** (`registry-boot-guard.ts:64–73`) if a SKILL.md lists
   `emit_verdict` in `allowed_tools` before the registry defines it. Land the
   registry entry + handler + every skill's `allowed_tools` **atomically** (one commit).
3. **Capture** — `let lastVerdict` on `sseEmitter` in `turn.ts` (~440), re-emit.
4. **Migration** — `addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN
   verdict_json TEXT;')` in `migrate.ts`.
5. **Persist** — `verdictJson?: string` in `AppendTurnParams` + INSERT binding
   (`chat-store.ts:291–401`); pass from `turn.ts` appendTurn call (~717).
6. **Load** — `verdict` on `TurnDto` + deserialize in `rowToTurn`
   (`sessions.ts:30–89`), assistant-only.

### Backend — prompt hardening (fix 2)
- In `cube-playground.md` + analytical skills (`explore`/`diagnose`/`advise`/
  `compare`): instruct the agent to call `emit_verdict` **once, first**, when
  answering an analytical question with data — a single takeaway sentence.
- Explicitly forbid meta-narration in the body ("task tracking isn't relevant",
  "waiting for the user", process commentary). Body = evidence framing only.
- **Do NOT** emit a verdict for pure clarification/disambiguation turns or
  chit-chat — only when there's a substantive data-backed answer.

### Frontend — render the verdict block
**RED-TEAM CORRECTION:** verdict renders ABOVE `bodyUnits` (it is NOT a section), so
it does NOT reuse the proposals/section plumbing. Budget ~6 wire-points across 3
files, not 3:
1. SSE event type + reducer case (`chat-stream-store-actions.ts`, switch ~299 has
   no `default:` throw — safe to add).
2. `StreamEntry` field + reset in `clearStreamBuffers`.
3. Live streaming: surface verdict in `buildStreamingSections` (or a sibling) so it
   shows before body finishes.
4. Committed-message build (assemble verdict onto the finished turn).
5. Persisted mapping (`chat-thread-page.tsx:63–67`) — hydrate `verdict` on load.
6. Render block in `assistant-message.tsx` above `bodyUnits` (~659): eyebrow +
   headline + rationale; tokens `--border-strong`, `--shell-brand` left accent,
   `--surface-raised`, `--radius-xl`. Shared renderer → both surfaces.
- **Streaming caveat:** the model usually emits `emit_verdict` LATE (after exploring),
  so "streams in early" is not wire-guaranteed. Assert verdict present **by `done`**,
  not by ordering; render it on arrival but don't block body on it.

## Related code files

Backend modify: `chat-service/src/types.ts`, `core/sse-stream.ts` (only if SDK
maps it), `api/turn.ts`, `db/chat-store.ts`, `db/migrate.ts`, `api/sessions.ts`,
new `tools/emit-verdict.ts` (match existing tool dir), `.claude/commands/
cube-playground.md`, `.claude/skills/{explore,diagnose,advise,compare}/`.

Frontend modify: `src/api/chat-sse-client.ts`, `src/pages/Chat/chat-thread-page.tsx`,
`src/pages/Chat/components/assistant-message.tsx`.

## Implementation steps

1. BE types: SSE event + `ChatTurnRow.verdict_json` + `VerdictData`.
2. `emit_verdict` tool + register; emit SSE event.
3. Capture in `turn.ts`; migration; persist in `chat-store.ts`; load in `sessions.ts`.
4. Prompt hardening: add emit_verdict instruction + meta-narration ban.
5. FE: SSE client type + persisted mapping + verdict block in `assistant-message.tsx`.
6. Tests: BE turn round-trip (emit→persist→load) incl. null/absent verdict;
   migration idempotency. FE: verdict renders when present, absent when null.
7. Live eval: run a real turn over SSE (host :3005 subscription lane per harness)
   — confirm a verdict emits on an analytical Q and NOT on a clarification turn.

## Todo

- [ ] SSE event + DB row types + `VerdictData`
- [ ] `emit_verdict` tool + SSE emit
- [ ] turn.ts capture + migration + persist + load
- [ ] Prompt: emit_verdict instruction + meta-narration ban
- [ ] FE SSE client + persisted mapping + verdict block render
- [ ] BE round-trip + migration-idempotency tests
- [ ] FE present/absent render tests
- [ ] Live SSE eval (analytical → verdict; clarification → none); both surfaces

## Success criteria

- Asking "what's the most pressing problem" leads with a verdict block stating
  the answer; charts sit below as evidence.
- No "task tracking isn't relevant…" / process meta in the body.
- Verdict persists and reappears on history reload.
- Clarification/disambig turns carry no verdict block.
- Renders identically in `/chat` and the right-side panel.

## Risks

- **Migration on a live DB**: must be idempotent + null-safe — old turns have no
  verdict; `rowToTurn` returns `null`, renderer hides the block. Verify backfill
  not required.
- **Agent over-emits**: verdict on trivial/clarification turns. Mitigate via
  prompt gating + the "only with data-backed answer" rule; verify in live eval.
- **SSE contract drift**: adding an event type must not break clients that ignore
  unknown events — confirm the FE SSE client tolerates unknown `type`.
- **Verified-decision guard**: prompt changes touch the diagnostic/prescriptive
  rail — keep the meta-narration ban additive; don't alter the rail's existing
  trust-guard behavior.

## Decisions (user-confirmed 2026-06-22)

1. **Verdict gating:** emit on ANY data-backed analytical answer (not skill-gated);
   renderer shows when present, hides when null.
2. **Cache-hit replay:** RE-EMIT the stored verdict on a cache hit (user-confirmed).
   **RED-TEAM CORRECTION — this is bigger than a replay tweak.** The response cache
   stores ONLY `{text, toolCalls, artifacts, charts}` (`response-cache-store.ts:25–30`);
   proposals/disambig are deliberately NOT cached. So re-emit requires a **4-file
   cache-schema extension**, not a one-liner:
   - extend `CachedValue` to carry `verdict` (`response-cache-store.ts:25–30`)
   - write-gate it on cache write (`response-cache-write.ts:77–82`)
   - emit the `verdict` event on replay (`replay-cached-turn.ts`)
   - persist verdict onto the replayed row (`try-response-cache-hit.ts:92–117`) — else
     reloading a replayed turn loses the verdict even after the live replay showed it.
   **RESOLVED (user-confirmed): FULL PARITY shipped** — all four cache files extended:
   `CachedValue.verdict`, write-gate `collectedVerdict`, replay re-emits the verdict
   before tokens (re-attached after the refresh hook overwrites the outcome), and
   `try-response-cache-hit` persists `verdictJson` on the replayed row. A cache-hit
   turn now renders identically to a fresh one. Covered by replay-artifacts.test.ts.
