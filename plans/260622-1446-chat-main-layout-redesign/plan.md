# Chat Main Layout Redesign

Status: **P01 shipped · P02 awaiting commit approval** · Created 2026-06-22 · Branch: main

Redesign the main `/chat` assistant turn so the answer leads with a synthesized
**verdict**, charts read as supporting evidence, and per-card chrome is lighter.
Grounded in a live mockup (approved direction) + two scouts of the FE renderer
and the `chat-service` turn pipeline.

Both `/chat` and the right-side chat panel share one renderer
(`chat-thread-view.tsx` → `chat-message-list.tsx` → `assistant-message.tsx`),
so every change lands on both surfaces automatically — each must be verified in
**both** (compact panel + full page).

## Phases

| Phase | Scope | Stack | Depends | Status |
|-------|-------|-------|---------|--------|
| [01](phase-01-frontend-layout.md) | Charts 2-col + y-axis autoscale + refine collapse + scope badge + control consistency (fixes 3–6) | Frontend only | — | DONE (committed d892cf1f) |
| [02](phase-02-verdict-field-and-prompt.md) | Structured `verdict` field end-to-end + prompt hardening to kill meta-narration (fixes 1–2) | Full-stack | — | DONE (implemented + reviewed; commit pending approval) |

**Sequencing (red-team):** P01 and P02 both edit `assistant-message.tsx` within
~10 lines of the `bodyUnits` map (`:659`) — they are NOT independent on that file.
Do them in **one branch**, or assign a single owner to that file. Recommend one
branch, P01 fixes first (lower risk), then P02 verdict.

## Decisions (locked)

- **Verdict source:** structured field, full-stack (user-confirmed). Agent emits
  via a dedicated `emit_verdict` tool, mirroring `emit_query_artifact` /
  `propose_segment`. NOT parsed from prose.
- **Verdict schema:** `{ headline: string; rationale?: string }`. Status tags
  from the mockup are out of scope (YAGNI) — revisit only if cheap to derive.
- **Y-axis autoscale:** apply to **trend charts only** (line / area / multi-line,
  + the line axis of dual-axis). **Bars/stacked stay zero-based** — truncating a
  bar baseline misrepresents magnitude. This is a deliberate data-viz call.
- **Reasoning disclosure:** already collapsed-by-default — no change. The meta-text
  leak is a prompt problem, fixed in P02.

## Key files

- FE renderer (shared): `src/pages/Chat/components/assistant-message.tsx`,
  `chat-message-list.tsx`, `chat-thread-view.tsx`
- FE chart card: `src/pages/Chat/components/assistant-chart-section.tsx`
- FE refine: `src/pages/Chat/components/query-refine-row.tsx`
- FE tokens: `src/theme/tokens.css`
- BE SSE/types: `chat-service/src/types.ts`, `chat-service/src/core/sse-stream.ts`
- BE turn pipeline: `chat-service/src/api/turn.ts`, `db/chat-store.ts`,
  `db/migrate.ts`, `api/sessions.ts`
- Agent prompt + skills: `chat-service/.claude/commands/cube-playground.md`,
  `chat-service/.claude/skills/{explore,diagnose,advise,compare}/`

## Mockup

Approved visual reference: scratchpad `chat-redesign-mockup.html`
(artifact `af9f6f08-1831-44cd-9c2b-fd67e55fe1f5`).

## Red-team outcome

Full report: `plans/reports/from-code-reviewer-to-planner-redteam-260622-1456-chat-redesign-plan-report.md`.
Verdict: BE structured-field parity + migration safety = sound. Three corrections
folded in: (#9 blocker) gate panel 1-col on `compact` not `embedded`; (#7) charts
live inside `query_artifact` cards so fix 3a+4 are coupled (do 4 first); (#1) cache
re-emit is a 4-file cache-schema change; (#10) scope chip is session-scoped header,
relocation ≠ CSS. SSE-unknown-event tolerance, migration idempotency, mid-stream
emit capability = confirmed safe.

## Decided (all confirmed 2026-06-22)

- Verdict emits on ANY data-backed analytical answer (not skill-gated).
- **Cache: FULL PARITY** — extend `CachedValue` + write-gate + replay-emit +
  persist-on-replay so a cached turn renders identically to a fresh one (P02).
- **Fix 5: PER-TURN scope badge** — derive each turn's scope from its own query
  artifact(s) and render under the question (NOT the session header chip) (P01).
- Multi-line autoscale → 0-floored; single-line → padded autoscale; bars → never.
- One branch for both phases (shared `assistant-message.tsx`).
