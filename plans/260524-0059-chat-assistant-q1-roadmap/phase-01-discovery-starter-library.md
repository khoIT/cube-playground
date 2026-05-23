# Phase 01 — Discovery: Starter Library (F1)

## Context Links
- Brainstorm: [brainstorm-260524-0059-chat-assistant-quarter-roadmap.md](../reports/brainstorm-260524-0059-chat-assistant-quarter-roadmap.md) §M1 Track A, F1.
- Existing landing surface: `src/pages/Chat/chat-landing-page.tsx`.

## Overview
- **Priority:** P1 (M1)
- **Status:** pending
- **Description:** Surface 16 business questions (from `cube-business-case.html` catalog) as clickable templates on chat landing page, persona-aware (PM / marketer / analyst).

## Key Insights (from brainstorm)
- Top friction F1 = users don't know what data exists; starters cut cold-start.
- Generic-UI trap mitigated by persona-aware filter on starters.
- Persona detection mechanism is open question (Q4) — resolve in this phase's design step.

## Requirements

### Functional
- Render starter cards on chat landing page (above composer or in dedicated section).
- 16 canonical questions sourced from a single TS module (mirror of business case).
- Each starter has: `id`, `text`, `personaTags` (`pm`/`marketer`/`analyst`), `targetCatalogIds` (metrics referenced).
- Click a starter → prefill composer + auto-submit (or open with editable text — design choice in step 1).
- Persona filter chips ("All / PM / Marketer / Analyst") toggle visible set.
- Persona default: `All` until persona detection resolves (Q4).

### Non-functional
- Zero added LLM cost (pure UI; clicking starter triggers normal turn).
- Click-through rate measurable via existing `chat_audit` table (new kind: `starter_clicked`).
- All starter texts localizable (placeholder for i18n; copy English-only Q1).

## Architecture
- **Data:** `src/pages/Chat/library/starter-questions.ts` (new) — static array.
- **Component:** `src/pages/Chat/components/starter-library-grid.tsx` (new).
- **Persona chip:** `src/pages/Chat/components/starter-persona-filter.tsx` (new).
- **Wiring:** `chat-landing-page.tsx` renders grid above composer when `composerValue===""` and no in-flight turn.
- **Telemetry:** `chat_audit.kind='starter_clicked'`, `detail_json={starterId, persona}`.

### Data flow
```
user → chat-landing → click card → setComposerValue(text) → openChatTurn(message=text)
                                 ↘ POST audit kind=starter_clicked
```

## Related Code Files

### Existing infra (from brainstorm §Existing infra)
| Capability | Path | Use |
|---|---|---|
| Chat landing | `src/pages/Chat/chat-landing-page.tsx` | Inject starter grid |
| Composer | `src/pages/Chat/components/chat-composer.tsx` | Programmatic value set |
| Catalog ids | `src/pages/Catalog/use-catalog-meta.ts` | Validate `targetCatalogIds` exist |
| Audit | `chat-service/src/db/schema.sql` `chat_audit` | Log starter_clicked |

### Create
- `src/pages/Chat/library/starter-questions.ts`
- `src/pages/Chat/components/starter-library-grid.tsx`
- `src/pages/Chat/components/starter-persona-filter.tsx`
- `src/pages/Chat/__tests__/starter-library-grid.test.tsx`

### Modify
- `src/pages/Chat/chat-landing-page.tsx` (render grid; trigger starter submit)
- `chat-service/src/services/` add audit helper if not present (or inline route)

### Delete
- None.

## Implementation Steps
1. Resolve Q4 persona detection — propose: user-selected on first chat session, stored in `chat_sessions` (new column `persona TEXT NULL`); default `null` shows All. Confirm with user before coding.
2. Author `starter-questions.ts` with 16 entries; cross-check each `targetCatalogIds` exists via `use-catalog-meta`.
3. Build `starter-library-grid.tsx`: 4×4 (desktop) / 1×16 (mobile) card grid; pass `onPick(starter)`.
4. Build `starter-persona-filter.tsx`: chip group ["All","PM","Marketer","Analyst"].
5. Wire into `chat-landing-page.tsx` — show grid when no in-flight turn; `onPick` sets composer value and calls `handleSubmit`.
6. Add audit POST on click (extend existing chat audit ingest endpoint or add `/api/chat/audit`).
7. Unit test grid (renders 16, filter narrows, click fires callback) + integration test on landing.

## Todo List
- [ ] Q4 resolution (persona detection)
- [ ] `starter-questions.ts` (16 entries, persona-tagged)
- [ ] Catalog id validation script in test
- [ ] `starter-library-grid.tsx`
- [ ] `starter-persona-filter.tsx`
- [ ] Landing page integration
- [ ] Audit logging
- [ ] Tests (unit + integration)

## Success Criteria (from brainstorm §Success metrics)
- ≥40% of new sessions start from a starter (M1 target).
- Click→submit latency <100ms (UI perceived).
- 100% of starter `targetCatalogIds` exist in catalog (test gate).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Starter texts drift from catalog (broken targetCatalogIds) | Med | Med | CI test asserts every id resolves via `use-catalog-meta`. |
| Persona detection blocks shipping | Med | Low | Ship with `All` default; persona is enhancement. |
| Starters answer-questions catalog can't actually serve | Low | High | Each starter must run through full agent path in test (smoke). |

## Security Considerations
- No PII in starter texts; static module.
- Audit row stores starterId + persona only; no message body duplication.

## Next Steps
- Blocks: none (M1 parallel).
- Unblocks: phase-04 (suggested follow-ups consume starter taxonomy).

## Rollback
Remove grid render from `chat-landing-page.tsx`; starter module is dead code, no DB writes to clean (audit kind ignored).
