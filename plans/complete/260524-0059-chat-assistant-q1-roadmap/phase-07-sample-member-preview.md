# Phase 07 — Sample Member Preview (F7)

## Context Links
- Brainstorm: §M2 F7 — "cheapest verification surface".
- Builds on phase-06 (consumes plan output) + existing identity-map.

## Overview
- **Priority:** P1 (M2)
- **Status:** pending
- **Description:** For any agent-proposed segment, fetch 10 anonymized sample members with per-row "this row matches because X" explanation. Lets non-tech user verify a segment without reading SQL.

## Key Insights
- Cheapest verification surface (a few rows beats charts for "is this right?").
- Anonymization mandatory — raw user ids never leave server.
- Explanation derives from segment predicate (which clauses each row satisfied) — server-side compute.

## Requirements

### Functional
- Agent (or UI) calls `sample-segment-members` tool returning `{ rows: [{ anonymizedId, matchedClauses: string[], dimensions: {...} }] }`.
- Limit 10 rows (configurable env var, default 10).
- Anonymization: hash `user_id` with per-game salt (already practice in `identity-map`).
- UI: collapsible panel under query-artifact-card.
- Per-row "Why match?" tooltip lists matched clauses with plain-English.
- Refresh button re-samples.

### Non-functional
- Sample query <2s p95 (existing preview infra benchmark).
- Salt never logged or sent to client.

## Architecture
- **Tool:** `chat-service/src/tools/sample-segment-members.ts` (new).
- **Server impl:** `server/src/services/segment-sampler.ts` — runs Cube query with `LIMIT 10` against the segment predicate, applies anonymization.
- **Explanation:** `predicate-to-explanation.ts` — given predicate + row values, return matched clause list.
- **UI:** `src/pages/Chat/components/sample-members-panel.tsx`.

### Data flow
```
plan run accepted ─► agent calls sample-segment-members(segmentRef|predicate)
                  ─► server runs Cube preview LIMIT 10
                  ─► hash ids + compute matched clauses per row
                  ─► UI renders panel with rows + tooltips
                  ↘ refresh button re-runs tool
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Preview service | `server/src/services/preview-service.ts` | Run Cube query |
| Identity map | `src/pages/Segments/identity-map/` + `server/src/routes/identity-map.ts` | Anonymization pattern |
| Predicate→SQL | `server/src/services/predicate-to-sql.ts` | Predicate evaluation pattern |
| Query artifact card | `src/pages/Chat/components/query-artifact-card.tsx` | Sibling render slot |

### Create
- `chat-service/src/tools/sample-segment-members.ts`
- `server/src/services/segment-sampler.ts`
- `server/src/services/predicate-to-explanation.ts`
- `server/src/routes/segment-sample.ts` (`POST /api/segment-sample`)
- `src/pages/Chat/components/sample-members-panel.tsx`
- `src/pages/Chat/components/sample-row-explanation.tsx`
- `server/src/services/__tests__/predicate-to-explanation.test.ts`

### Modify
- `chat-service/src/tools/registry.ts` (register)
- `src/pages/Chat/components/query-artifact-card.tsx` (mount panel)

### Delete
- None.

## Implementation Steps
1. Author `predicate-to-explanation.ts` — pure function `(predicate, row) => matchedClauseStrings[]`.
2. Author `segment-sampler.ts` — runs preview-service with limit, applies hashing.
3. Expose `POST /api/segment-sample` accepting `{ segmentRef | predicate, gameId }`.
4. Add chat tool wrapping route.
5. Build `sample-members-panel.tsx` — table view + refresh.
6. Wire into `query-artifact-card.tsx` (collapsible by default; auto-expand for first segment in session).
7. Tests: explanation for known predicate matches expected clauses; anonymization hash deterministic per salt.

## Todo List
- [ ] `predicate-to-explanation.ts` + tests
- [ ] `segment-sampler.ts` (anonymization wired)
- [ ] `POST /api/segment-sample` route
- [ ] `sample-segment-members` tool
- [ ] `sample-members-panel.tsx`
- [ ] query-artifact-card integration
- [ ] Salt config check (no env-leak)

## Success Criteria
- ≥60% of segment-emitting turns view the panel (M2 target).
- Explanation accuracy ≥95% in QA matrix (matched clauses correct).
- No raw user ids ever returned (security gate test).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Hash collision exposes user identity across sessions | Low | High | Salt rotates per game per quarter; doc + alarm. |
| Sample query timeouts | Med | Med | Cap query time 3s; degrade gracefully ("sample unavailable"). |
| Predicate-to-explanation drifts from SQL semantics | Med | High | Shared parser between predicate-to-sql and predicate-to-explanation. |

## Security Considerations
- **PII boundary:** raw `user_id` never leaves server; UI receives `anonymizedId` only.
- Salt stored in `server/data/.salt-<game_id>` (gitignored); env override.
- Audit log entry per sample request (use phase-05 audit).

## Next Steps
- Blocked by: phase-06 (plan output → segment predicate source).
- Blocks: phase-09 (sanity check may reference samples for context).

## Rollback
Unregister tool + route; UI panel hidden by feature flag. No data persisted (samples are ephemeral).
