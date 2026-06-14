# Advisor Run Audit Console

Admin observability UI (like `dev/chat-audit`) over every in-process advisor agent run: every run, turn, tool call, LLM result, artifact, cost, and time — to debug & optimize the agent and make failure modes (cold-Trino timeouts, denied tools) legible.

## Locked decisions (from requirements gate)
- **Capture depth:** full tool-call trace (name, inputs, output digest, duration, ok/failed/denied, error) + turn summary + artifacts + **append-only SSE event log for replay**.
- **Placement:** admin hub cross-user at `/admin/dev/advisor-audit`; `requireRole('admin')` + `requireFeature('admin')`.
- **Mitigation scope:** surface failures distinctly **+ actionable next-step hints** per failure type. No agent behavior change this round.
- **Retention:** persist every run to SQLite (`segments.db`); prune > `ADVISOR_AUDIT_RETENTION_DAYS` (default 30).

## Key context (verified)
- Advisor agent runs **in-process** in `server` (not a remote service like chat) — so persistence is local SQLite, not an HTTP proxy.
- Today **not durable**: `agent-audit-log.ts` writes turn records only to the Fastify logger; sessions + provenance ledger + cost are in-memory (`agent-session-registry.ts`). Only drafts persist (`command-center-draft-store.ts`).
- Tool **inputs/outputs/per-call duration/error are not recorded today** — the core gap for debugging the screenshot timeout case.
- DB: `src/db/sqlite.ts` `getDb()`; migrations are numbered SQL files applied by `user_version` count — next is **`055-`**. Draft store (`command-center-draft-store.ts`) is the mirror pattern.
- Admin route mirror: `server/src/routes/admin-chat-audit.ts` + `requireRole`/`requireFeature`; registered in `src/index.ts`. UI mirror: `src/pages/Admin/hub/cross-user-audit-panel.tsx` + `cross-user-audit-data.ts`, tab via `dev-hub-panel.tsx`. Tokens: `src/theme/tokens.css`.
- **PII guard:** new agent-dir files are auto-scanned by `advisor-agent-no-pii-surface.test.ts`. Persisted tool I/O must stay on the existing allowlist (user_id + numeric + reachability); store the **post-redaction** output, never raw member rows.

## Phases
| Phase | Title | Status | Depends |
|---|---|---|---|
| 01 | Persistence store + migration 055 + RunRecorder interface | ✅ Done | — |
| 02 | Runtime instrumentation (tool-call timing, event buffering, wire recorder) | ✅ Done | 01 |
| 03 | Admin audit routes (`/api/admin/advisor/runs*`) | ✅ Done | 01 |
| 04 | Admin UI panel + failure hints + hub tab | ✅ Done | 03 |
| 05 | Tests sweep + finalize (docs / project-mgmt / journal) | ✅ Done | 01–04 |

## Implementation notes (sync-back 2026-06-15)
- Shipped exactly to plan. Store API consolidated to a single transactional `persistTurn()` write path (+ `listRuns`/`getRunDetail`/`listEvents`/`listOwners`/`pruneOlderThan` reads) — simpler than the per-table `recordRun/recordTurn/...` split the phase sketch listed; same coverage.
- Recorder seam: `RunRecorder` interface + `sqliteRunRecorder` (default, swallows errors, once-per-process retention prune) + `noopRunRecorder` (tests). Injected via `deps.recorder` in `createAdvisorAgentSession`.
- Runtime instrumentation threads tool `input` + a truncated (4000-char) post-redaction `resultText` through the normalizer. **These two fields are recorder-only**: stripped at the SSE edge in `advisor.ts` so the live client wire contract is unchanged (code-review H1).
- An open tool call at turn end (e.g. a `cube_query` killed by the timeout) is recorded `failed` with elapsed duration — the cold-Trino case the console exists to debug.
- The `denied` tool-state branch is forward-compat only: SDK canUseTool denials currently surface as `tool_result` `is_error` → recorded `failed` (code-review M1).
- Tests: `advisor-run-store` (6), `advisor-run-recorder` (3), `admin-advisor-audit-route` (6), `advisor-failure-hints` (8). Full server suite 1638 pass / 1 skip; frontend 2449 pass; no-PII guard green.

## Out of scope (this round)
- Changing agent guardrails / retry / warm-up behavior (mitigation = surface + hints only).
- Self-scoped `/dev/advisor-audit` page (admin-only this round).
- Per-tool LLM token/cost breakdown beyond the SDK's per-turn `total_cost_usd` (SDK doesn't attribute cost per tool).
- Migrating draft/feedback storage.

## Success criteria
- Every advisor turn (incl. a timed-out cold-Trino run) is durably recorded with each tool call's duration + state + error message.
- Admin can open `/admin/dev/advisor-audit`, filter by owner/game/stopReason, drill run → turn → tool call, replay SSE frames, and see a next-step hint on failed runs.
- Non-admin gets 403. New agent files pass the no-PII surface guard. Full server suite green. No regression to live advisor turns.
