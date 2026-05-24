# Phase 08 — Plain-English Filter Trace (F6)

## Context Links
- Brainstorm: §M2 F6.
- Sibling to phase-07; share `predicate-to-explanation` infra.

## Overview
- **Priority:** P2 (M2)
- **Status:** pending
- **Description:** Every query result shows a "filtered by X AND Y, grouped by Z" panel alongside SQL. Plain-English derivation of the executed query so non-tech users can sanity-check.

## Key Insights
- Complements phase-07: samples show "who", filter trace shows "what filter logic produced them".
- Derives from the same predicate as samples — share translator.

## Requirements

### Functional
- For every query artifact, render trace panel: ordered list of clauses, group-by, time window.
- Each clause uses term labels (resolved via glossary phase-03 when available).
- Toggle SQL ↔ Plain-English (default plain).
- Copy-as-text button.

### Non-functional
- Render <100ms (pure transformation client-side from artifact JSON).

## Architecture
- **Util:** `src/pages/Chat/services/predicate-to-plain-english.ts` (client-side mirror of phase-07 server util — share types).
- **UI:** `src/pages/Chat/components/filter-trace-panel.tsx`.

### Data flow
```
query artifact ─► predicate-to-plain-english(predicate, glossary) ─► clause list ─► UI panel
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Query artifact card | `src/pages/Chat/components/query-artifact-card.tsx` | Host panel |
| Reasoning trace | `src/pages/Chat/components/reasoning-trace.tsx` | Pattern reference |
| Glossary endpoint (phase-03) | `/api/glossary` | Term label resolution |
| Predicate-to-explanation (phase-07) | `server/src/services/predicate-to-explanation.ts` | Share clause-rendering logic |

### Create
- `src/pages/Chat/services/predicate-to-plain-english.ts`
- `src/pages/Chat/components/filter-trace-panel.tsx`
- `src/pages/Chat/__tests__/predicate-to-plain-english.test.ts`

### Modify
- `src/pages/Chat/components/query-artifact-card.tsx` (mount panel + toggle).
- Optionally extract shared clause renderer into a util used by both client + server (DRY).

### Delete
- None.

## Implementation Steps
1. Extract clause rendering to shared util (TS) consumed by both `predicate-to-explanation.ts` (phase-07 server) and `predicate-to-plain-english.ts` (this phase client). Avoid duplication.
2. Build client util `predicate → string[]` taking glossary cache.
3. Build panel with SQL/Plain toggle + copy.
4. Wire into query-artifact-card; default plain.
5. Tests: known predicate produces known sentence; glossary override changes label.

## Todo List
- [ ] Shared clause-rendering util (DRY w/ phase-07)
- [ ] `predicate-to-plain-english.ts`
- [ ] `filter-trace-panel.tsx`
- [ ] query-artifact-card integration
- [ ] Tests

## Success Criteria
- ≥80% of QA users in dogfood can read plain-English version without consulting SQL.
- Plain-English text matches semantics of SQL (test gate).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Plain-English drifts from SQL semantics | Med | High | Shared util; test matrix of predicate variants. |
| Long predicates → wall of text | Med | Low | Truncate with "show all" expander after 8 clauses. |

## Security Considerations
- No PII. Glossary terms only.

## Next Steps
- Blocked by: phase-06 (consumes plan predicate), phase-03 (glossary for labels).
- Independent of phase-07 except for shared util.

## Rollback
Hide panel via feature flag in query-artifact-card; util dead code.
