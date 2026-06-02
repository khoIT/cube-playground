# Whale Resolver Quick-Fix: Glossary Term Navigation

**Date**: 2026-06-03 05:24
**Severity**: Medium
**Component**: Catalog / Glossary / Resolver
**Status**: Resolved

## What Happened

Glossary concept terms (whale/dolphin/minnow) dead-ended at `/catalog/glossary` index when clicked. The resolver (`resolveGlossaryHref`) only branched on `primaryCatalogId`, leaving no fallback for rows with `defaultFilter` or `defaultMeasureRef`.

## The Fix

Modified `src/pages/Catalog/glossary/resolve-glossary-link.ts` to implement fallthrough logic:
1. If `primaryCatalogId` exists → navigate to `/catalog/metric`
2. Else if `defaultFilter` or `defaultMeasureRef` exist → navigate to `/build` with pre-filtered query (JSON-encoded, operations mapped to Cube operators: `equals/notEquals/gt/gte/lt/lte`, `IN/NOT IN` collapsed to array equality)
3. Else anchor-scroll to glossary row via `#<id>`

Also updated `glossary-index-page.tsx` with `useLocation` hash-scroll and one-time flash on `[data-glossary-id]` rows.

## What Made This Painful

The plan's "Modify" list was underspecified. `glossary-row.tsx` gated its chip on `primaryCatalogId` and chat's `LinkedSegment` dropped concept-tier fields. Neither surface would reach Build view without two extra edits: un-gate the row chip + carry `defaultFilter`/`defaultMeasureRef` through `use-glossary-linker.ts` to `assistant-message.tsx`. Lesson: trace resolver callers before trusting a phase's file list.

## Testing & Validation

- 17 resolver/linker unit tests green
- Full Chat (92) + Catalog (47) suites passing
- Production build clean
- tsc 0 new errors

## Next Steps

Commit `9a4fc5e` staged on `feat/whale-resolver-quickfix` (not pushed). Phases 1–5 remain pending; P2+ blocked on P1 UX-prototype sign-off.

---

**File written:** `/Users/lap16299/Documents/code/cube-playground/docs/journals/260603-0524-whale-resolver-quickfix.md`
