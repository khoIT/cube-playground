# Phase 11 — User Glossary Memory (F10)

## Context Links
- Brainstorm: §M3 F10. **§"Catalog-consistency rule"** (overrides flagged, never silent).
- Direct consumer of phase-06 (editable plan "Save as personal override").
- Extends phase-03 (concept glossary).

## Overview
- **Priority:** P1 (M3)
- **Status:** pending
- **Description:** Persist user-defined overrides of glossary terms scoped per `(owner_id, game_id)`. Agent reads override before defaulting to catalog. **Always surface divergence from catalog — never silent.**

## Key Insights (CRITICAL)
- Override is a **lens** over catalog, NOT a replacement. Storage references `catalog_ref` always.
- Catalog-consistency rule: when override active, UI shows "your definition differs from catalog default — [revert | edit | propose update]" badge on every related turn.
- Scope: per-user × per-game ONLY in Q1 (decision Q3). NO cross-game transfer of any kind — not even opt-in stub. Deferred entirely to Q2. Team-level glossary deferred to Q2 (governance unresolved).

## Requirements

### Functional
- Table `glossary_overrides` in chat-service DB.
- `POST /api/chat/glossary-overrides` — `{ termId, catalogRef, params, label? }` keyed by (session user, game).
- `GET /api/chat/glossary-overrides?gameId=` — list active overrides for current user × game.
- `DELETE /api/chat/glossary-overrides/:id` — revert.
- Agent core: before resolving any term, check override → fall back to catalog default.
- UI surface: phase-06 plan cells consume this endpoint; settings page lists & manages overrides.
- Divergence badge component reused in plan cells + sample-members panel.

### Non-functional
- Override lookup <10ms (single indexed query, cached per session).
- All writes audited (kind=`override_created|override_reverted`).

## Architecture

### Schema (chat-service DB)
```
CREATE TABLE IF NOT EXISTS glossary_overrides (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  term_id TEXT NOT NULL,           -- glossary_terms.id
  catalog_ref TEXT NOT NULL,       -- e.g. business_metrics/whale_payer
  params_json TEXT NOT NULL,       -- override params
  label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glossary_overrides_owner_game
  ON glossary_overrides(owner_id, game_id, term_id);
```

### Service
- `chat-service/src/services/glossary-resolver.ts` — `resolveTerm(ownerId, gameId, termId) → { catalogRef, params, source: 'override'|'catalog' }`.
- Caching: per-session in-memory; invalidate on POST/DELETE.

### Data flow
```
agent needs "whale" → glossary-resolver(owner, game, "whale")
  ├─► glossary_overrides hit → return override + source=override
  └─► miss → /api/glossary catalog default → source=catalog
plan-cell render → if source=override → show divergence badge + revert option
POST /api/chat/glossary-overrides (from plan-cell "Save as personal override")
DELETE /api/chat/glossary-overrides/:id (from settings or badge revert)
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Chat-service DB | `chat-service/src/db/chat-store.ts` + `schema.sql` | New table |
| Catalog defaults (phase-03) | `server/src/routes/glossary.ts` | Default source |
| Plan cell (phase-06) | `src/pages/Chat/components/execution-plan-cell.tsx` | Override write trigger + badge consumer |
| Agent core | `chat-service/src/core/` | Inject resolver |
| Audit | `chat_audit` table | Override events |

### Create
- `chat-service/src/db/glossary-overrides-migrate.ts`
- `chat-service/src/services/glossary-resolver.ts`
- `chat-service/src/routes/glossary-overrides.ts`
- `chat-service/src/services/__tests__/glossary-resolver.test.ts`
- `src/pages/Chat/components/divergence-badge.tsx` (or share with phase-06 `divergence-flag-badge.tsx` — DRY check)
- `src/pages/Settings/glossary-overrides-list.tsx`

### Modify
- `chat-service/src/db/schema.sql` (table)
- `chat-service/src/core/` agent loop — invoke resolver
- `src/pages/Chat/components/execution-plan-cell.tsx` — wire override POST
- `src/pages/Settings/` settings page index (add link)

### Delete
- None.

## Implementation Steps
1. Schema + migrate.
2. `glossary-resolver.ts` with cache.
3. Routes POST/GET/DELETE + Zod validation.
4. Agent core: replace direct catalog reads with `resolveTerm`.
5. Reconcile `divergence-flag-badge.tsx` (phase-06) ↔ `divergence-badge.tsx` (this phase). Pick one location; consolidate.
6. Settings page list — view, revert, "propose catalog update" deeplink.
7. Tests: override write → resolver returns override; delete → returns catalog default; cross-game isolation (user1 game1 override invisible to user1 game2).
8. E2E: phase-06 "Save as personal override" flow end-to-end.

## Todo List
- [ ] Schema + migrate
- [ ] `glossary-resolver.ts` + cache
- [ ] Routes (POST/GET/DELETE)
- [ ] Agent core integration
- [ ] Badge consolidation
- [ ] Settings page list
- [ ] Tests (unit + e2e flow)

## Success Criteria (from brainstorm)
- ≥5% "Save as personal override" rate of turns with edits (M2 target — surfaces here as endpoint usage).
- 0 silent overrides (every active override surfaces divergence badge — UI test).
- Cross-game isolation gate (test).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Resolver cache stale after delete | Med | High | Invalidate on every write; per-session scope. |
| Override grows unbounded | Low | Low | Soft cap 200 per user × game; warn UI. |
| Cross-user leakage | Low | High | Server enforces owner from session; integration test. |
| Divergence badge confusing | Med | Med | Inline help; "what does this mean" link to docs. |

## Security Considerations
- **PII:** override values may include user-chosen thresholds; no user pii but `owner_id` scope critical.
- Server NEVER trusts client `owner_id` — always from session.
- Cross-game scope: query MUST filter both owner_id AND game_id; integration test asserts.
- Audit log every write.

## Next Steps
- Blocked by: phase-06 (consumer), phase-03 (default source), phase-10 (shares DB migrate cadence).
- Blocks: none in Q1.

## Rollback
Drop table + routes; resolver falls through to catalog default. Audit retained.
