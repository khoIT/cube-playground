# Phase 04 — Admin UI panel + failure hints + hub tab

## Overview
- **Priority:** P1. **Status:** ✅ Done. **Depends on:** 03
- Build the cross-user audit UI at `/admin/dev/advisor-audit`, mirroring `cross-user-audit-panel.tsx`. 3-pane: filters/run-list → run detail → tool-call + event drill-down, with **failure badges + actionable next-step hints**.

## Architecture
3-pane layout (mirror `cross-user-audit-panel.tsx` 3-pane: picker/list 220–280px, list flex, detail flex):
- **Left:** filters — owner dropdown (`/api/admin/advisor/owners`), game, goal, stopReason (`all`/`end_turn`/`timeout`/`max_turns`/`budget`/`aborted`/`error`), free-text `q`.
- **Middle:** run list rows — scope chip, goal, owner, turn_count, cost, duration, `created_at`; **failure runs flagged** with a destructive-soft badge showing stopReason.
- **Right:** run detail — header (scope/goal/owner/model/total cost/turn count), turn timeline; each turn shows narration + tool-call rows (tool, duration, state badge `ok`/`failed`/`denied`, error message on failure). Expandable **SSE event replay** per turn (ordered frames from the events route).
- **Failure hint banner:** when a run/turn failed, render a next-step hint from `advisor-failure-hints.ts`.

`advisor-failure-hints.ts` (pure mapping, unit-tested) — input `{ stopReason, abortCause, toolErrors[] }` → `{ title, hint }`:
- `timeout` + repeated `cube_query` failures → "Cold Trino — first query timed out. Warm up with a small/narrow query, or narrow the time window; retries usually succeed once Trino is warm."
- `budget` → "Hit the cost ceiling. Narrow the question or raise maxBudgetUsd."
- `max_turns` → "Investigation needed more steps than allowed. Ask a narrower question or raise maxTurns."
- `tool_denied` (denied rows) → "Agent tried a tool outside the advisor allowlist — expected guardrail; no action needed."
- `aborted` → "User/client disconnected mid-turn — session stays resumable."
- `error`/`sdk_error` → "Unexpected SDK error — check the event replay for the failing frame."

## Related code files
**Create (under `src/pages/Admin/hub/`):**
- `advisor-audit-panel.tsx` — the 3-pane panel.
- `advisor-audit-data.ts` — `fetchAdvisorRuns`, `fetchAdvisorRunDetail`, `fetchAdvisorRunEvents`, `fetchAdvisorOwners` (mirror `cross-user-audit-data.ts` + `apiFetch`).
- `advisor-failure-hints.ts` — pure failure→hint mapping.
- (optional) `advisor-audit-run-row.tsx`, `advisor-audit-tool-call-row.tsx` if the panel exceeds ~200 lines (modularize).
**Modify:**
- `src/pages/Admin/hub/dev-hub-panel.tsx` (or the admin hub tab list) — add an "Advisor Audit" tab.
- Router wiring if the hub uses path-based tabs (mirror how chat-audit tab routes).

## Design (MANDATORY — design-guidelines.md)
- Tokens only: `var(--text-primary/secondary/muted)`, `var(--bg-card/muted)`, `var(--border-card)`, semantic `--destructive-soft/ink`, `--warning-soft/ink`, `--success-soft/ink`, `--info-soft/ink`. No hex.
- `var(--font-sans)` for text, `var(--font-mono)` for ids/timestamps/durations.
- Spacing from the scale (10/12/14/16/20/24/32); list-row padding `11px 14px`; pane divider `1px solid var(--border-card)`.
- Cross-check against `cross-user-audit-panel.tsx` + Dashboards before shipping.

## Todo
- [ ] `advisor-audit-data.ts` fetch helpers
- [ ] `advisor-failure-hints.ts` + unit test
- [ ] `advisor-audit-panel.tsx` 3-pane (filters / list / detail)
- [ ] tool-call rows with state badges + error; SSE event replay (expandable, paginated)
- [ ] failure badge on list rows + hint banner in detail
- [ ] hub tab + route wiring
- [ ] design cross-check vs cross-user-audit-panel + tokens
- [ ] test: hints mapping pure fn; panel renders list→detail without pageerror (smoke)

## Success criteria
- Admin opens `/admin/dev/advisor-audit`, filters `stopReason=timeout`, opens the cold-Trino run, sees which `cube_query` timed out (duration + error) and a "Cold Trino — warm up / narrow window" hint; can replay the SSE frames.
- Non-admin can't reach it (route + server gate).
- Tokens/spacing match the adjacent admin panel (no drift).

## Risks
| Risk | Mitigation |
|---|---|
| Design drift | Copy structure from `cross-user-audit-panel.tsx`; tokens-only; cross-check. |
| Panel > 200 lines | Extract row components per modularization rule. |
| Event replay payload size | Paginated events route; lazy-load on expand. |

## Security
- Admin-gated UI over admin-gated routes; renders only PII-free persisted fields.
