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
- Persona detection: behavior-inferred from topic histogram after ≥3 sessions; cold-start shows all starters.

## Requirements

### Functional
- Render starter cards on chat landing page (above composer or in dedicated section).
- 16 canonical questions sourced from a single TS module (mirror of business case).
- Each starter has: `id`, `text`, `personaTags` (`pm`/`marketer`/`analyst`), `targetCatalogIds` (metrics referenced), `categoryTags` (subset of intent-router categories: `explore|metric_explain|compare|diagnose`).
- Click a starter → prefill composer text (NO auto-submit). User edits then sends.
- Cold-start (sessions<3): show all 16 starters unranked. After 3+ sessions: rank by topic-histogram match (intent_router category counts from chat_audit).

### Non-functional
- Zero added LLM cost (pure UI; clicking starter triggers normal turn).
- Click-through rate measurable via existing `chat_audit` table (new kind: `starter_clicked`).
- All starter texts localizable (placeholder for i18n; copy English-only Q1).

## Architecture
- **Data:** `src/pages/Chat/library/starter-questions.ts` (new) — static array.
- **Histogram:** `src/pages/Chat/library/persona-histogram.ts` (new) — derives weight per starter from session history (reads last 20 sessions' intent_router categories, normalizes to vector).
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
1. Build `persona-histogram.ts` — reads last 20 sessions' intent_router categories (from `chat_audit.kind=intent_routed`), normalizes to vector.
   - Cold-start threshold sourced from `chat-service/src/config.ts` constant `STARTER_RANK_MIN_SESSIONS = 3` (decision C5). Single source; no env var, no DB row.
2. Each starter declares `categoryTags` (subset of intent-router categories: `explore|metric_explain|compare|diagnose`).
3. Ranking: cosine of starter.categoryTags vector × user histogram. Cold-start (sessions<3) = uniform weights / unranked.
4. Author `starter-questions.ts` with 16 entries; cross-check each `targetCatalogIds` exists via `use-catalog-meta`.
5. Build `starter-library-grid.tsx`: 4×4 (desktop) / 1×16 (mobile) card grid; pass `onPick(starter)`.
6. Build `starter-persona-filter.tsx`: chip group ["All","PM","Marketer","Analyst"].
7. Wire into `chat-landing-page.tsx` — show grid when no in-flight turn; `onPick` sets composer value only (NO auto-submit).
8. Add audit POST on click (extend existing chat audit ingest endpoint or add `/api/chat/audit`).
9. Unit test grid (renders 16, ranking narrows, click prefills composer without submitting) + integration test on landing.

## Todo List
- [ ] Starter category tag schema (`explore|metric_explain|compare|diagnose`)
- [ ] `persona-histogram.ts` (cosine ranking; cold-start fallback)
- [ ] `starter-questions.ts` (16 entries, persona-tagged + categoryTags)
- [ ] Catalog id validation script in test
- [ ] `starter-library-grid.tsx`
- [ ] `starter-persona-filter.tsx`
- [ ] Landing page integration (prefill only, no auto-submit)
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
| Starters answer-questions catalog can't actually serve | Low | High | Each starter must run through full agent path in test (smoke). |

## Security Considerations
- No PII in starter texts; static module.
- Audit row stores starterId + persona only; no message body duplication.

## Next Steps
- Blocks: none (M1 parallel).
- Unblocks: phase-04 (suggested follow-ups consume starter taxonomy).

## Rollback
Remove grid render from `chat-landing-page.tsx`; starter module is dead code, no DB writes to clean (audit kind ignored).
