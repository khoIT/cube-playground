# Phase 03 — Concept Glossary (F3)

## Context Links
- Brainstorm: §M1 Track A, F3. Catalog-consistency rule §"Catalog-consistency rule".
- Existing concept page: `src/pages/Catalog/concept-detail/`.

## Overview
- **Priority:** P1 (M1)
- **Status:** pending
- **Description:** User-facing glossary of business terms (whale, DAU, LTV, …) each mapped to one or more catalog field ids. Clickable from any chat answer to surface "what does this mean".

## Key Insights
- Glossary is the **canonical bridge** between business language and catalog ids — phase-06 (editable plan) and phase-11 (user override) consume this mapping.
- Concept detail page already exists; this phase adds (a) glossary index page, (b) click-from-chat behaviour, (c) term→catalog mapping store.
- Authoritative defaults stored centrally; user overrides land in phase-11 (memory).

## Requirements

### Functional
- Glossary index page lists ~30 canonical terms with: term, short description, primary catalog id mapping, secondary mappings.
- Search + filter (alphabetical / category).
- Click term → existing concept-detail route (reuse).
- Chat assistant messages auto-link recognised terms (case-insensitive, word boundary) to glossary anchor.
- Term→catalog mapping read via server endpoint `GET /api/glossary` so chat-service + UI share single source.

### Non-functional
- Mapping store is server-side flat JSON (or table) → 1 read per session, cached.
- Auto-link parser must not break existing markdown rendering.

## Architecture
- **Storage:** `server/data/glossary.seed.json` (committed) → migrated into a small SQLite table `glossary_terms` for queryability + future Q2 team-glossary expansion.
- **Server route:** `server/src/routes/glossary.ts` — `GET /api/glossary`.
- **UI:**
  - `src/pages/Catalog/glossary/glossary-index-page.tsx`
  - `src/pages/Catalog/glossary/glossary-search.tsx`
  - `src/pages/Catalog/glossary/glossary-row.tsx`
- **Chat term linker:** `src/pages/Chat/components/assistant-message.tsx` post-render pass that wraps known terms in `<a href="/catalog/concept/<conceptId>">`.

### Schema (glossary_terms)
```
CREATE TABLE glossary_terms (
  id TEXT PRIMARY KEY,        -- e.g. "whale"
  label TEXT NOT NULL,        -- "Whale"
  description TEXT NOT NULL,
  primary_catalog_id TEXT,    -- e.g. business_metrics/whale_payer
  secondary_catalog_ids TEXT, -- JSON array
  aliases TEXT,               -- JSON array (case-insensitive match)
  category TEXT,
  updated_at INTEGER NOT NULL
);
```

### Data flow
```
seed.json ─► migrate ─► glossary_terms
GET /api/glossary ─► UI index + chat linker cache
chat assistant_text ─► tokenize ─► match aliases ─► render link
click link ─► /catalog/concept/<id> (existing route)
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Concept detail page | `src/pages/Catalog/concept-detail/concept-detail-page.tsx` | Re-used for click target |
| Catalog meta | `src/pages/Catalog/use-catalog-meta.ts` | Validate catalog ids in mapping |
| Server route bootstrap | `server/src/routes/` | New route lands here |
| Server SQLite | `server/data/segments.db` (existing) | Add glossary table or use separate file |
| Assistant message | `src/pages/Chat/components/assistant-message.tsx` | Term linker |

### Create
- `server/data/glossary.seed.json`
- `server/src/routes/glossary.ts`
- `server/src/db/glossary-migrate.ts`
- `src/pages/Catalog/glossary/glossary-index-page.tsx`
- `src/pages/Catalog/glossary/glossary-search.tsx`
- `src/pages/Catalog/glossary/glossary-row.tsx`
- `src/pages/Chat/components/use-glossary-linker.ts`
- `server/src/routes/__tests__/glossary.test.ts`

### Modify
- Router config (add `/catalog/glossary`).
- `src/pages/Chat/components/assistant-message.tsx` (term linker hook).
- `server/src/index.ts` (register route, run migrate on boot).

### Delete
- None.

## Implementation Steps
1. Author `glossary.seed.json` (~30 terms; whale, DAU, MAU, LTV, ARPU, retention day-N, churn, etc.). Each term lists `primary_catalog_id`.
2. Add migrate script — idempotent insert from seed on boot.
3. Build `GET /api/glossary` route.
4. Build glossary index page + search.
5. Build `use-glossary-linker` hook — fetch once, build trie / regex.
6. Wrap matched terms in `assistant-message.tsx` (post-markdown, careful not to wrap inside `<code>` blocks).
7. Validation script: every `primary_catalog_id` resolves via catalog meta (CI test).
8. Tests: route returns terms; linker wraps "whale" but not "whales" (boundary); linker skips code blocks.

## Todo List
- [ ] Author seed (~30 terms)
- [ ] Migrate script
- [ ] `GET /api/glossary` route
- [ ] Glossary index page + search + row
- [ ] `use-glossary-linker` hook
- [ ] assistant-message integration
- [ ] CI test for catalog-id integrity
- [ ] Unit tests for linker + route

## Success Criteria
- ≥1 glossary click per session avg (M1 target).
- 0 mappings reference non-existent catalog ids (CI gate).
- Linker false-positive rate <5% in QA sample (no breaking code blocks).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Linker breaks markdown / code rendering | Med | High | Post-render DOM walk that skips `<code>`, `<pre>`, link nodes. |
| Term ambiguity ("retention" = day1 vs day7) | High | Med | Prefer multi-mapping; concept-detail disambiguates. |
| Seed drifts out of date | Med | Med | CI test; quarterly review item in roadmap. |

## Security Considerations
- Read-only endpoint, no auth needed beyond existing session.
- No PII; terms are public business vocabulary.

## Next Steps
- Blocks: phase-06 (editable plan resolves term → catalog id via glossary), phase-11 (user override extends this mapping).
- Independent of 01, 02, 04, 05.

## Rollback
Unregister `/catalog/glossary` + linker hook; leave table in place (no data loss).
