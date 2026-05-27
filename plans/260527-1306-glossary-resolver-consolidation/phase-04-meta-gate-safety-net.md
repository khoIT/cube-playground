# Phase 04 — /meta gate as safety net

## Context Links
- `chat-service/src/tools/disambiguate-query.ts:46-52` — `collectRefsToValidate`
- `chat-service/src/tools/disambiguate-query.ts:145-159` — the gate that forces `action:clarify`
- `chat-service/src/core/cube-meta-cache.ts` — `getMeta`, `extractMemberNames`
- `chat-service/src/nl-to-query/query-composer.ts:22-26,32-37` — `isValidRef` member check

## Overview
- **Priority:** P2 (small; depends on 02/03)
- **Status:** done
- Now that resolved refs are always cube members, the gate stops being a structural trap and
  becomes what it was meant to be: catch genuine typos / missing-cube cases.

## Key Insights
- Pre-fix, the gate rejected `business_metrics/revenue` (a catalog path) on EVERY revenue query.
  Post-fix, the only refs reaching it are members from the resolver — so a rejection now means a
  real mismatch (cube not in this game's /meta, or a `measureRef` pointing at a renamed member).
- **Ratio terms** carry no single `ref` but DO carry `ratioRef:{numerator,denominator}` — the
  gate must validate BOTH members. If either is absent from `/meta`, fall back to clarify (don't
  emit a half-built ratio query). `collectRefsToValidate` collects both ratio members.
- A `ref:null` AND `ratioRef:null` (expression/unknown term) must NOT reach the gate as a member.
  The gate skips it (the resolver already produced a `reason`-tagged clarify).
- Keep the gate's clarify fallback message, but improve it: when a term resolved but its
  `measureRef` is absent from `/meta`, the message should name the term and the missing member
  (telemetry-friendly), not the generic "could not find that".

## Requirements
- Functional: `collectRefsToValidate` ignores `undefined`/`null` metric refs (already does via
  `if (result.slots.metric.value)`), confirm dimension/filter parity, and collects BOTH ratio
  members when present.
- Functional: gate still forces clarify on a true unknown member; warning string names slot+ref.
- Functional: ratio terms auto-route when both members exist; clarify (gate) only if a member is
  missing. Expression/unknown terms route to clarify via the resolver `reason`, not the gate.
- Non-functional: no behavior change for queries that already auto-routed correctly.

## Architecture / Data flow
```
resolution
  ├─ ref=member        → gate: knownMembers.has(member)? yes→auto / no→clarify+warning
  ├─ ratioRef={n,d}     → gate: has(n) AND has(d)? yes→auto(2-measure query) / no→clarify+warning
  └─ ref=null,ratio=null → resolver-produced clarify (reason) — gate skips
```

## Related Code Files
- **Modify:** `chat-service/src/tools/disambiguate-query.ts:145-159` — keep the structure; refine
  the clarify message to include term + member when available; ensure null refs never enter
  `collectRefsToValidate` as members.
- **Possibly modify:** `chat-service/src/nl-to-query/query-composer.ts` — confirm `isValidRef`
  still drops null refs from `measures` (it does; no member emitted for null).

## Implementation Steps
1. Audit `collectRefsToValidate`: confirm it only pushes truthy refs (metric guarded; dimension
   guarded; filters iterate `member`); add ratio numerator+denominator collection; null guard on
   filter `member` if missing.
2. Refine the fallback clarification copy (EN+VI) to name the unresolved member.
3. Add a warning telemetry line distinguishing "expression — no single measure" (resolver
   `reason`), "ratio member missing from /meta" (gate, names which side), and "member missing
   from /meta" (gate). Keep all in `result.warnings`.
4. Build chat-service — no type errors.

## Todo List
- [x] Null (expression/unknown) refs never treated as members by the gate
- [x] Both ratio members validated; missing → clarify (no half-built query)
- [x] Gate clarify message names term + missing member
- [x] expression-vs-ratio-missing-vs-typo distinguishable in warnings
- [x] chat-service compiles

## Success Criteria
- "show revenue last 7 days" passes the gate (member exists) → `auto`.
- "show retention rate" → both ratio members in /meta → `auto` (two-measure query).
- A glossary term whose `measureRef` (or a ratio member) is absent from a given game's /meta →
  `clarify` with a warning naming the member (genuine safety-net trigger).
- An expression/unknown-term phrase → `clarify` with the resolver `reason`, NOT a member warning.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Game-specific /meta lacks a member the seed assumes (multi-game) | M×M | Gate correctly clarifies; warning names the member so ops can fix the catalog/seed. This is desired safety-net behavior |
| Null ref slips through as the string "null"/empty | L×H | Explicit guards in step 1; Phase 05 test for expression term |
| Ratio with one valid + one missing member emits a broken half-query | M×H | Gate validates BOTH; either missing → clarify before composeQuery emits measures |
| Over-trusting resolver, gate becomes dead code | L×L | Keep the gate; it is cheap and the only defense against catalog/meta drift |

## Security Considerations
- Gate is defensive: prevents sending invalid refs to Cube `/load`. Strengthens, not weakens.

## Next Steps
- Phase 05 validates the whole chain against the eval corpus + new plain-intent cases.
