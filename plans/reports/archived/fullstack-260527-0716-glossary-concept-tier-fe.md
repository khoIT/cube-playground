# Glossary Concept Tier FE — Implementation Report

**Date:** 2026-05-27  
**Phase:** 02a-FE

## Files Modified

| File | Change |
|---|---|
| `src/api/glossary-client.ts` | Added `GlossaryTrustTier`, `GlossaryFilter`, `GlossaryRanking` types; extended `GlossaryTerm` with 6 concept-tier fields; added `isConceptTerm()` helper; extended `GlossaryWriteInput` via `GlossaryConceptInput` |
| `src/pages/Catalog/glossary/glossary-edit-form.tsx` | Added `concept: ConceptTierValues` to `FormValues`; wired `toForm()` to unpack existing term's concept data; added `setConcept()` partial-patch helper; rendered `<GlossaryConceptTierSection>` above submit |
| `src/pages/Catalog/glossary/glossary-index-page.tsx` | Imported `parseConceptTier`; extended `onSave` payload with all 6 concept fields (skips `defaultFilter` when JSON parse error) |
| `src/pages/Catalog/glossary/glossary-row.tsx` | Added `ConceptBadge` styled component; renders when `isConceptTerm(term)` is true; shows entity cube in `title` tooltip |

## File Created

| File | Purpose |
|---|---|
| `src/pages/Catalog/glossary/glossary-concept-tier-section.tsx` | Self-contained collapsible "Concept tier" sub-section with all 6 fields: entity_cube (text), entity_pk (text), default_measure_ref (text), default_filter_json (JSON textarea + parse validation), ranking (order select + limit number), trust_tier (select). Exports `ConceptTierValues`, `ConceptTierResult`, `parseConceptTier()`. |

## Server Side (already done — verified only)

- GET `/api/glossary/spender` → all 6 fields round-trip ✓
- PUT `/api/glossary/spender` with concept fields → persists + round-trips ✓
- `glossary-validators.ts` Zod schema: `DefaultFilter` op allowlist, strict `Ranking` shape ✓
- `glossary-row-mapper.ts`: `rowToTerm()` maps all 6 columns ✓
- `glossary.ts` route: `SELECT_COLS` includes all 6, INSERT/UPDATE writes them ✓

## Round-Trip Verification

```
GET /api/glossary/spender →
  entityCube: "players", entityPk: "players.user_id",
  defaultMeasureRef: "recharge.revenue_vnd",
  defaultFilter: {member: "recharge.revenue_vnd", op: ">", value: 0},
  ranking: {order: "DESC", default_limit: 10},
  trustTier: "certified"

PUT /api/glossary/spender (same payload) →
  ranking: {order: DESC, default_limit: 10} | trustTier: certified | entityCube: players  ✓
```

## Tests

- Server: `npx vitest run` → 276 passed (38 files), 0 failures. Glossary seed logs: `[glossary] seeded 47 term(s)`.
- FE glossary: `npx vitest run src/pages/Catalog/glossary` → 5 passed (1 file, existing resolve-glossary-link tests).
- Server typecheck (`cd server && npx tsc --noEmit`): clean.
- FE typecheck (`npx tsc --noEmit`): 0 errors in glossary files. Pre-existing errors in unrelated files (cdp-projection, Segments, Schema) — not introduced by this change.

## Design compliance

- Uses `var(--info-soft)` / `var(--info-ink)` for concept badge (semantic pair, dark-mode compatible).
- All inputs use `var(--border-card)`, `var(--bg-input)`, `var(--text-primary)`, `var(--font-sans)`, `var(--brand)`.
- Error state uses `var(--destructive-ink)`.
- Spacing stays on the 4/6/8/10/12 scale.
- Section toggle uses `var(--bg-subtle)` / `var(--bg-muted)` — matches existing collapsible patterns.
- No raw hex, no new fonts.

## Unresolved questions

None. Server layer was complete; FE layer is now complete.

---

**Status:** DONE  
**Summary:** All 6 concept-tier fields surface in the edit modal (collapsible section, JSON validation on filter), a concept badge appears on qualifying rows, the API client and form values are fully typed, and the write path sends the fields to the server.  
**Concerns:** None.
