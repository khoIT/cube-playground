---
phase: 6
title: "Frontend Briefing + Generate flow"
status: complete
priority: P1
effort: "1.5d"
dependencies: [3, 4]
---

# Phase 6: Frontend Briefing + Generate flow

## Overview
The primary dashboard surface (`:5180`): two columns (Product/data-layer experience · Code architecture/performance), top-3 idea cards each, plus the "Generate briefing" button that triggers a run and streams live progress until cards refresh.

## Requirements
- Functional: Briefing page renders ranked top-3 `status=new` per category from `GET /api/ideas`. Each card shows problem → evidence (clickable, sanitized file/Confluence/email refs) → proposal → impact×effort badge → rendered visual (recharts) → actions (Accept / Dismiss / Snooze). "Generate briefing" → `POST /api/runs` (with shared-secret header), subscribes to SSE, shows a live progress log, refreshes cards on `done`.
- Non-functional: Vite + React 18 + TS strict; **recharts** for visuals (no mermaid); shares idea TS types with backend via the single-package shared schema (`src/shared/idea-schema.ts`); minimal token set echoing cube-playground for visual kinship (not coupled).

## Architecture
- `frontend/` Vite app, dev `:5180`, proxies `/api` → `:5181`.
- `useEventSource` hook for SSE progress; `useIdeas` query hook.
- `IdeaCard` component: renders evidence list + `<VisualRenderer>` that renders `suggestedVisual.kind:chart` via recharts from a small validated spec (recharts-only v1; unknown kind → empty state).
- `GenerateButton`: disabled while a run is active (reflects backend 409 lock); progress drawer/log streams parsed `progress` events.
- Shared types: import the zod-inferred `Idea` type from `src/shared/idea-schema.ts` via a Vite path alias (single package — no copied `.d.ts`).

## Related Code Files
- Create: `frontend/` Vite scaffold (`index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`)
- Create: `frontend/src/pages/Briefing.tsx`
- Create: `frontend/src/components/IdeaCard.tsx`, `VisualRenderer.tsx`, `GenerateButton.tsx`, `ProgressLog.tsx`
- Create: `frontend/src/hooks/useIdeas.ts`, `useRunStream.ts`
- Create: `frontend/src/theme/tokens.css` (minimal, echoing cube-playground)
- Create tests: `frontend/test/IdeaCard.test.tsx`, `VisualRenderer.test.tsx`, `useRunStream.test.ts`

## TDD — Tests First
1. `IdeaCard.test.tsx` (RTL): given an idea fixture → renders title, problem, each evidence ref as a link, impact/effort badge, and an action per status; Accept fires the expected callback.
2. `VisualRenderer.test.tsx`: `kind:chart` renders a recharts container from a validated spec; unknown/unsupported kind → graceful empty state (no crash); a malformed/hostile spec → empty state, never throws.
3. `useRunStream.test.ts`: mock EventSource → hook surfaces ordered progress events + a `done` transition that invalidates the ideas query.
4. Implement until green.

## Implementation Steps
1. Scaffold Vite app + proxy + tokens.css.
2. Build `useIdeas` + `useRunStream` hooks against Phase 3/4 APIs.
3. Build `IdeaCard` + `VisualRenderer` + `Briefing` two-column layout.
4. Build `GenerateButton` + `ProgressLog` wired to SSE; refresh on done; reflect run-lock.
5. Green component tests; manual end-to-end smoke (Generate → progress → cards).

## Success Criteria
- [ ] Component + hook tests green
- [ ] Briefing renders real top-3 per category with working evidence links + visuals
- [ ] Generate button drives a real run, streams progress, refreshes cards on completion, and is disabled during an active run
- [ ] Visual fidelity cross-checked against a cube-playground page (typography/spacing kinship)

## Risk Assessment
- recharts spec from LLM may be malformed → `VisualRenderer` validates the spec + wraps in an error boundary with empty-state fallback; never renders raw/unsanitized content.
- Type sharing drift between FE/BE → derive `Idea` type from the single zod schema; CI typecheck both.
- Long runs → progress log must feel alive; ensure parser granularity (Phase 3) is sufficient.

## Red Team Hardening (applied)
- **recharts-only, drop mermaid** (#A3): `VisualRenderer` supports `kind:chart` (recharts) only for v1 — mermaid is NOT a cube-playground dependency and the "mirror" claim was false. Unknown/legacy `kind` → graceful empty state.
- **Render untrusted idea data safely** (#15): `evidence[].ref` is rendered as a link ONLY if it passed ingest sanitization (http/https/file refs; `javascript:`/`data:` already rejected in Phase 4). Never `dangerouslySetInnerHTML`; the chart spec is validated, not eval'd. The dashboard shares the (token-protected, loopback) API origin, so a hostile ref must not be clickable-to-execute.
- **Single-package type sharing** (#A4): import the `Idea` type from `src/shared/idea-schema.ts` via Vite path alias — no copied `.d.ts`. One zod schema, one inferred type, both sides.
- **Briefing shows `status=new`** (#SC9): top-3 per category are `status=new` (ranked `impact-effort`). Accepted ideas move to an "In motion" lane (not Briefing) so they don't crowd new ideas; this lane + Backlog cover lifecycle. Reconnect/replay uses `Last-Event-ID` (Phase 3); GenerateButton disabled-state derives from the authoritative `runs` row, not local state, so a server restart can't wedge it.
