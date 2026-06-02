---
phase: 3
title: "Linking & Affordance"
status: pending
priority: P2
effort: "3-5d"
dependencies: [2]
---

# Phase 3: Linking & Affordance

## Overview
Make every term resolve to the right destination everywhere (chat, build, catalog), with a typed hover-card and consistent chip treatment. Replaces the single-field `resolveGlossaryHref` with a model-driven resolver. Sequenced **before P4** (P4's badge-on-chip depends on P3's chip; both edit `glossary.ts`) — or split by explicit file-ownership globs if truly parallelized (C11). After P2.

## Requirements
- Functional:
  - `resolveConcept(term)` reads the full P2 model → returns `{ primary destination, typed actions[] }`. Primary chosen by term nature (a payer-tier term → its field/segment, not a count metric).
  - **Deep-link to the specific term** (`/catalog/glossary#<id>` or term detail) — never the index. P0 already ships the minimal `#<id>` anchor; P3 generalizes it (term-detail / typed destinations).
  - **Hover-card** on any term anchor: 1-line definition + threshold + up to N typed actions — Define / Slice by `<field>` (Build) / Open segment / See metric.
  - **Consistent chip treatment** unifying chat `{{field:…}}` chips, glossary anchors, catalog links: metric ▦ / concept ⓘ / field code-chip / segment ◑ (per P1 prototype decisions).
  - Chat grounding **prefers certified** (the **resolved** per-game trust, not declared — C6): NL term → certified definition/ref; drafts ranked lower; surface trust badge. Consumes via the back-compat `?status=official` alias until cutover (C3).
- Non-functional: resolver pure + unit-tested; no extra round-trips per anchor (batch term lookups).

## Architecture
- Replace `resolveGlossaryHref` with **two** units (NOT a drop-in — the current fn is sync, called inline in JSX `to={…}`, C9): a **sync** `resolveConceptHref(term)` returning a `string` (operates on already-fetched term fields, no network) for links, and an **async** `useConceptResolution` hook (batched `GET /api/concepts/resolve`) for hover-card typed actions. Migrate the 2 JSX callers explicitly (`assistant-message.tsx:125`, `glossary-row.tsx:128`). Old `business_metrics/<slug>` path preserved. P0's resolver fallback is the seed of `resolveConceptHref`.
- Hover-card = shared component used by chat assistant-message anchors, build, and catalog. Data from a batched `GET /api/concepts/resolve?terms=…`.
- Chat: the **server owns the registry**; `chat-service` resolves NL terms via the existing HTTP glossary/concepts API (Q3 resolved — extend the existing `?status=official` contract to carry resolved trust + refs; thin client, no forked registry). Prefer certified refs; pass trust to the FE for badge.

## Related Code Files
- Modify: `src/pages/Catalog/glossary/resolve-glossary-link.ts` → generalize to `resolve-concept.ts`
- Modify: `src/pages/Chat/components/assistant-message.tsx`, `src/pages/Chat/components/field-chip.tsx`, `src/pages/Chat/components/use-glossary-linker.ts`
- Create: `src/components/concept-chip/*` (shared typed chip), `src/components/concept-hover-card/*`
- Read: chat-service NL resolution tools (Open Q3), `server/src/services/concept-reverse-index.ts` (P2)

## Implementation Steps
1. Build `resolveConcept()` + unit tests (whale→field+segment; revenue→metric; cohort→definition; never index).
2. Shared concept-chip + hover-card components (from P1 affordance decisions).
3. Wire chat anchors + field-chips + catalog links through the shared chip; batch resolve endpoint.
4. Deep-link terms to specific glossary entry, not index.
5. Chat grounding: prefer certified refs; expose trust to badge. Integration point = server registry via existing chat-service HTTP client (Q3 resolved).

## Success Criteria
- [ ] Zero term→index dead-ends; whale/dolphin/minnow resolve to field+segment+definition
- [ ] One chip vocabulary across chat/build/catalog; type legible at a glance
- [ ] Hover-card shows definition + typed actions
- [ ] Chat resolves NL terms to certified definitions, badge shown
- [ ] `resolveConcept` unit-tested incl. legacy `business_metrics/` path

## Risk Assessment
- Per-anchor fetch storms → batch resolve + module cache (mirror `use-identity-map`).
- Over-ambitious hover-card → cap actions at N; degrade to definition-only when refs absent.
