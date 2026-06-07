# Phase 03 — Additive follow-up detection + query merge

## Context links

- Depends on: [phase-01](phase-01-starter-passthrough-memory-write.md),
  [phase-02](phase-02-cube-anchored-metric-fallback.md).
- `src/cache/disambig-memory-adapter.ts` — `DisambigResolutions` (gets a new
  `lastQuery` field), `mergeResolution`.
- `src/tools/emit-query-artifact.ts` — authoritative place to persist the
  executed query (the agent may have tweaked limit/order after disambiguate).
- `src/nl-to-query/intent-classifier.ts` — pattern reference for the
  bilingual conservative-regex style; additive detector is a SIBLING module,
  not a fifth `QueryIntent` value (additive composes with trend/aggregate).
- Failing transcript: "add in user count per day" (EN); VI equivalents:
  "thêm số người chơi mỗi ngày", "cùng với doanh thu".

## Overview

Priority P1. Recognize "extend the previous chart with one more measure" and
return ONE merged query instead of resolving the message standalone.

## Architecture

### 1. Persist the last executed query

- Extend `DisambigResolutions` with
  `lastQuery?: SlotMemory<string>` (JSON-serialised `CubeQuery`; SlotMemory
  keeps the adapter uniform — `phrase` carries the artifact title).
- Write site A: `emit_query_artifact` handler — after a successful emit,
  `mergeResolution(db, sessionId, ownerId, { lastQuery: { value: JSON.stringify(query), phrase: title } })`.
  No-op when `ctx.db` absent (unit-test discipline already established).
- Write site B: starter pass-through (phase 01 factory) — chips bypass
  emit-time tweaks rarely, but cover the gap anyway.
- Focus adapter NOT extended — lastQuery is machine context, not
  prompt-rendered (token bloat guard, phase-02 R2 precedent).

### 2. Additive detector

New module `src/nl-to-query/additive-follow-up.ts`:

```
detectAdditiveFollowUp(message): { isAdditive: boolean; residualPhrase: string }
```

- Conservative bilingual markers anchored near message start:
  `/^(add(\s+in)?|also\s+(show|include|add)|include|plus|show\s+also|thêm|bổ\s*sung|cùng\s*(với)?|kèm(\s*theo)?)\b/i`
  plus mid-shape `add <X> to (the|this) (chart|graph|series|biểu đồ)`.
- `residualPhrase` = message minus marker + trailing chart-reference tokens
  ("to the chart", "per day" KEPT — granularity hints stay).
- Filter-additive IS in scope (user decision 2026-06-07): "add a filter for
  iOS", "only VIP users", "thêm điều kiện chỉ user VIP" merge a filter into
  lastQuery instead of appending a measure — see step 3b.

### 3. Handler wiring (disambiguate-query.ts)

After memory fill, when `detectAdditiveFollowUp(...).isAdditive` AND
`mem.lastQuery` parses:

1. Resolve `residualPhrase` → glossary `resolveTerm` first, then phase-02
   `resolveAgainstAnchorCube` anchored to `lastQuery`'s primary cube.
2. Best match is a **measure** ≥ `chatGlossaryAutorouteThreshold`:
   - `result.query = { ...lastQuery, measures: dedupe([...lastQuery.measures, member]) }`
   - `result.action = 'auto'`, clear clarifications;
   - warning `additive merge: appended <member> to previous query "<title>"`;
   - assumption disclosure (slot 'metric') for the skill-body footer;
   - memory write persists the new metric slot as usual (memory now points
     at the added member; lastQuery refreshes on the subsequent emit).
3. Cross-cube case (glossary resolves to a measure on ANOTHER cube, e.g.
   "add DAU" while charting etl_game_detail): do NOT merge two cubes into one
   query (join semantics unverified) — return auto with the OTHER cube's
   standalone query (today's behavior) + warning
   `additive requested but <member> lives on <cube>; emitted standalone query`
   so the agent explains the split to the user.
3b. **Filter-additive**: when the engine's own filter extraction
   (slot-extractor) already produced `slots.filters` for the residual, OR the
   residual resolves to a dimension member on the anchor cube:
   - filters with values (engine extracted member+op+values) → merge into
     `lastQuery.filters` (append, dedupe by member+op+values), keep measures/
     timeDimensions untouched, action='auto', warning
     `additive merge: appended filter <member> to previous query`.
   - dimension WITHOUT a value ("add a filter for platform") → clarify asking
     for the value, options from `list_dimension_values`-style top values is
     out of scope — plain question text is enough (the agent's normal
     pipeline handles the reply since dimension lands in memory).
   - value with ambiguous member ("only iOS") → reuse the engine's existing
     filter resolution; if it can't pin the member, clarify with anchor-cube
     string dimensions as options (phase-02 candidates machinery, kind
     filter).
4. No confident measure OR filter → clarify with phase-02 contextual options.

### 4. Multi-measure chart sanity

`emit_query_artifact` + FE chart spec already accept multi-measure queries
(starter chips emit them — `buildStarterQuery` collects `measures[]`).
Verify one FE render manually in phase 04; scale mismatch (2.1M matches vs
~300K users on one axis) is acceptable v1 — note for a dual-axis follow-up.

## Related code files

- Create: `src/nl-to-query/additive-follow-up.ts`
- Modify: `src/cache/disambig-memory-adapter.ts` (lastQuery field + normalise)
- Modify: `src/tools/emit-query-artifact.ts` (write site A)
- Modify: `src/tools/disambiguate-starter-passthrough.ts` (write site B, via phase-01 factory)
- Modify: `src/tools/disambiguate-query.ts` (wiring)
- Tests: `src/nl-to-query/__tests__/additive-follow-up.test.ts`,
  extend `src/tools/__tests__/disambiguate-query*.test.ts`

## Todo

- [x] `lastQuery` in DisambigResolutions + normalise + adapter tests
- [x] emit-query-artifact write site (+ no-db no-op test)
- [x] `detectAdditiveFollowUp` with EN/VI positives + negatives
- [x] Handler merge path (same-cube measure)
- [x] Cross-cube standalone path + warning
- [x] Filter-additive merge path (engine-extracted filters → lastQuery.filters)
- [x] Filter-additive clarify paths (dimension w/o value; ambiguous member)
- [x] Replay test: starter "Matches played per day — last 30 days" then
      "add in user count per day" → auto, measures=[matches, distinct_players],
      timeDimensions preserved

## Success criteria

The exact failing conversation resolves end-to-end in unit tests without LLM
involvement: merged auto query, one artifact, disclosure footer.

## Risk

- **Stale lastQuery TTL** — kv kind `disambig_resolution` already carries the
  session TTL; an expired row simply disables the additive path (graceful).
- **"add" false positives** ("address", "added value") — `\b` anchors +
  near-start requirement; negative tests.
- **Measure dedupe** — appending an already-present member must not duplicate
  (idempotent merge).
