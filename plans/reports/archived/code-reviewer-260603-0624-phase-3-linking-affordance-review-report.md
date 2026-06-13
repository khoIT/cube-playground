# P3 "Linking & Affordance" — Code Review

Scope: git diff vs HEAD, P3 changes only. FE (cube-playground).
Verified: tokens.css, tests run, tsc on P3 files, seed data trace.

## Acceptance criteria verdict

| # | Criterion | Verdict |
|---|-----------|---------|
| a | No term→index dead-ends; href never bare `/catalog/glossary` | MET (tested) |
| b | ONE ConceptChip vocabulary in glossary-row + chat | MET |
| c | Hover-card: definition + typed actions, degrades, caps | PARTIAL — segment action dead for payer-tier terms (see C1) |
| d | Trust badge on chip + hover-card | MET |
| e | resolveConcept unit-tested incl legacy path; old tests green | MET (27/27 green) |

Tests: `resolve-concept` 11, `resolve-glossary-link` 11, `use-glossary-linker` 5, `concept-chip` 11 — all pass. No TS errors in any P3 file (72 repo-wide errors are pre-existing, e.g. `concept-detail-page.tsx`, out of scope).

---

## Critical

None (no data loss / security / auth). The C1 below is high-impact correctness but not data-destructive.

## High

**H1 — Async relations + "Open segment" never fire for the terms they target (concept-hover-card.tsx:75).**
`conceptRef = term.primaryCatalogId ?? null`. The payer-tier terms (whale/dolphin/minnow) that the spec names as the showcase for cross-layer segment links all have `primary_catalog_id: null` (server/data/glossary.seed.json:153,170,185). So `useConceptResolution(null)` → idle, no fetch, **no segment action ever rendered for whale/dolphin/minnow**. Criterion (c)'s async "Open segment" is effectively dead for the exact terms it was designed for. The data needed is present: build the ref from the data-model member instead, e.g. `term.entityCube && term.defaultFilter ? \`data_model/${term.defaultFilter.member}\` : term.primaryCatalogId`. Then the `data_model` branch of `getRelations` returns the segments that filter on that member.

**H2 — Ref shape mismatch for data-model-backed terms (concept-hover-card.tsx:75 + concepts-client.ts:66 + server parseRef).**
Several terms store `primaryCatalogId` as a bare cube member with no namespace (`mf_users.country`, `mf_users.platform`, `mf_users.ltv_vnd`, …; seed shows ~10). Passing that as `ref`:
- `getConceptRelations` splits on first slash → no slash → throws `Invalid concept ref` → hook `.catch` → silent fail (degrades to definition-only, but a guaranteed-wasted code path).
- Even if a slash existed, namespace `mf_users` is not in `REF_NAMESPACES` → 400.
Fix: normalize before calling — bare `cube.member` must become `data_model/<member>`; only `business_metrics/<slug>` and `segments/<id>` pass through unchanged. Centralize this in `concepts-client` or a small `toConceptRef(primaryCatalogId)` helper so chat + catalog agree.

**H3 — Abort poisons the module cache permanently (use-concept-resolution.ts:26-41, 34, 56-57).**
`fetchRef` shares one in-flight promise per ref created with the *first* subscriber's `AbortController.signal`. On that subscriber's unmount the cleanup calls `controller.abort()` → native fetch rejects `AbortError` → `.catch` writes `errors.set(ref, AbortError)`. Consequences:
1. **Shared-signal cancellation race:** if card B subscribed to the same ref while A's fetch was in flight, B reuses A's promise; A unmounting aborts B's load too. B shows error despite never aborting.
2. **Cache poisoning:** the AbortError is cached in `errors`, never invalidated. Every subsequent mount for that ref reads `errors.has(ref)` (lines 57, 72) → returns error state forever for the tab session. A single hover-then-leave-before-settle permanently breaks that ref.
This is the real bug behind the known `act()` warning — not just test hygiene. Fixes: (a) do not pass a per-subscriber signal into the shared fetch (let the shared fetch run to completion; cancellation of one consumer must not abort shared work), and (b) don't cache AbortError — on abort, just `inflight.delete(ref)` without writing `errors`, or filter `err.name === 'AbortError'` out of the error cache. The listener-removal already prevents setState-after-unmount, so dropping the signal is safe.

## Medium

**M1 — Slice operator map duplicated, divergence risk (resolve-concept.ts:43-49 vs resolve-glossary-link.ts:37-46).**
`buildSliceHref` inlines a second copy of the `op → Cube operator` map. Currently identical to `OP_TO_CUBE_OPERATOR`, so no behavioral bug today, but criterion 1 explicitly flags this: two copies will drift. Export `OP_TO_CUBE_OPERATOR` / `toCubeFilter` from `resolve-glossary-link.ts` and reuse. KISS/DRY.

**M2 — Missing tests for hover-card + use-concept-resolution.**
Task lists `concept-hover-card/__tests__` and `use-concept-resolution` tests as deliverables; only `concept-chip.test.tsx` exists. The cache/abort logic (H3) is exactly the code that needs a test — a test for "two subscribers, one unmounts mid-flight, the other still resolves" would have caught H3. Add it.

**M3 — Hover-card injects a global `<style#chc-styles>` as a module side-effect (concept-hover-card.tsx:171-182).**
Runs at import time. Fine in browser, but it's a module-level DOM mutation (untestable in jsdom without document, and couples render correctness to import order). Minor: consider injecting inside an effect or a one-time guarded call from the component. Also the `:hover/:focus-within` reveal is the only show mechanism — see L2 for a11y.

## Low / Nits

**L1 — `data_model` glyph in affordance spec is `＃` but chip `field` kind uses `＃` and the slice action also uses `＃`** — consistent, fine. No action.

**L2 — a11y: hover-card dismiss + touch (concept-hover-card.tsx:171-182).**
Reveal is CSS `:hover`/`:focus-within` only. Keyboard reach works *because* the chip is a `<Link>`/`<button>` (focusable) and the card is a focus-within sibling — good. But: (a) no `Escape`-to-dismiss; (b) touch devices have no hover; (c) `role="tooltip"` on a container holding interactive `<Link>`s is semantically off (tooltips shouldn't contain focusable actions — consider `role="menu"`/no role, or a real popover). Not blocking for an internal tool, but note it.

**L3 — chip button accessible name** — `<button>` variant relies on visible label text (present) + glyph is `aria-hidden`. Accessible name OK. Consider a `title`/`aria-label` when label is truncated. Minor.

**L4 — Glyph order glyph-source mismatch (concept-hover-card.tsx:127):** `ACTION_GLYPH[action.kind] ?? action.glyph` — async segment actions set both `kind:'segment'` and `glyph:'◑'`, and `ACTION_GLYPH.segment='◑'`, so redundant but harmless.

---

## Specific-check answers

1. **Action order** — Correct: Define → Slice → See metric (resolve-concept.ts pushes in that order; test asserts `kinds[0]==='define'`, `kinds[last]==='metric'`). Matches affordance-decisions.md. **Slice reuses P0 filter→operator logic?** No — it *re-implements* it (M1). Identical today, divergence risk. **resolveConceptHref regression?** None — it's a literal re-export of `resolveGlossaryHref` (resolve-concept.ts:25); P0 routing identical, 11 P0 tests still green.
2. **Async hook** — Cache key correct (`ref` string). **Stale across terms?** No (keyed by ref). **Race on same ref / abort / unmount?** Real bug — H3 (shared-signal cancellation + AbortError cache poisoning). setState-after-unmount itself is prevented by listener removal; the act() warning reflects async settle but the abort path is a genuine correctness bug.
3. **Tenancy/perf** — `getConceptRelations` is **NOT hover-gated**: `useConceptResolution` fires in `useEffect` on mount whenever `conceptRef` non-null. In the glossary index every metric-backed row fires a relations fetch on page load (~30 distinct refs). Module cache dedups same-ref, so it's bounded by distinct refs, not a true storm, but it is render-time not hover-time — contrary to the spec's "only fires on hover". Server-side scoping is correct (workspace + game_id, concepts.ts + concept-reverse-index.ts:141-143). Cache keyed correctly by ref. Recommend: defer the fetch to first hover (lift a `hovered` state, or pass ref only on pointer-enter).
4. **Design-system** — Tokens only, all 24 referenced tokens exist in tokens.css. Chip/badge use QB member-type + semantic tokens per spec. Inter via `--font-sans`. No raw hex in P3 files (glossary-row's `rgba(...)` fallbacks are pre-existing styled-components `var(--x, fallback)` defaults, not P3-introduced). Compliant.
5. **Blast radius** — `termsById` threaded cleanly through `buildMarkdownComponents → transformLeaves → renderTextLeaf → pushGlossaryChunks`; the only new behavior is wrapping a term chip in `<ConceptHoverCard>` when `fullTerm` is found, else bare chip (graceful). Cite tokens, field chips, plain text paths untouched. `field-chip.tsx` unchanged. No regression.
6. **Plan-artifact refs** — None in P3 files. The `phase-02`/`phase-04` comments in assistant-message.tsx are pre-existing (not added by this diff). Clean.
7. **a11y** — see L2/L3.

---

## Unresolved questions

1. H1/H2 ref normalization: is the intended ref for a data-model-backed term `data_model/<defaultFilter.member>` or `data_model/<entityCube>`? Spec's affordance grid implies the member (slice target). Confirm before fixing.
2. Is render-time relations fetch (criterion-3) acceptable for the ~30-row glossary index, or must it be hover-deferred per the spec wording? Product call.
3. Were hover-card / use-concept-resolution tests intentionally deferred, or dropped? Task lists them as deliverables.
