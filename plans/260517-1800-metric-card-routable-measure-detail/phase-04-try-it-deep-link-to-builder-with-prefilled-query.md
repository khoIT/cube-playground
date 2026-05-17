---
phase: 4
title: "Try-it deep-link to Builder with prefilled query"
status: completed
priority: P2
effort: "0.5d"
dependencies: [1]
---

# Phase 4: Try-it deep-link to Builder with prefilled query

## Context Links

- Existing partial deep-link (cube only): `src/pages/Catalog/detail-panel.tsx:127` (`/build?cube=${name}`)
- **Existing `?cube=` URL reader (CONFIRMED via validation):** `src/QueryBuilderV2/QueryBuilder.tsx:112-125` — already reads `URLSearchParams` from `window.location.hash.split('?')[1]`, waits for meta, applies `selectCube`, then strips param via `window.history.replaceState`.
- **QueryBuilder query state setter:** `src/QueryBuilderV2/hooks/query-builder.ts:483` exposes `setQuery(query: Query)` taking a full Cube Query object. There is NO separate `addMeasure` or `addTimeDimension` — the multi-setter API doesn't exist. Validation Session 1 confirmed this.

## Overview

Add a **Try it** button on the Metric Card that builds a deep-link to `/build` with a pre-filled query and navigates to it. Validation Session 1 confirmed the QueryBuilder ALREADY has a hash-router-aware `?cube=` reader at `QueryBuilder.tsx:112-125`. This phase EXTENDS that existing `useEffect` to also read `measure`, `time`, `range` params, and applies them via a single `setQuery(query: Query)` call (the only setter that exists — there's no `addMeasure`/`addTimeDimension`).

`dateRange` uses **Cube native strings** directly (e.g. `"last 30 days"`, `"this month"`) per Validation Session 1 — no custom RANGE_KEYS dictionary needed. The Cube SDK understands these tokens natively in `Query.timeDimensions[].dateRange`.

The button choice depends on what the cube exposes:
- If the cube has a `type: time` dimension → `Try it: by <timeDim>, last 30 days` (most demoable)
- Else → `Try it: count` (scalar-only fallback)

## Priority

P2 — completes the demo arc. The card without Try-it is still useful (browse / explain); with Try-it, it becomes a discovery → action loop.

## Key Insights

- **Existing `?cube=` reader confirmed.** `QueryBuilder.tsx:112-125`. Hash-router-aware. Pattern: read params, wait for meta, apply via the QB setters, then `window.history.replaceState` to strip. This phase extends the SAME `useEffect`, not adds a new one.
- **`setQuery(query: Query)` is the only entry point.** No separate `addMeasure`/`addTimeDimension`. Build a Cube `Query` object once and apply atomically: `setQuery({ measures: [fqn], timeDimensions: [{ dimension, granularity, dateRange }] })`.
- **dateRange is Cube native string.** Cube SDK accepts `"last 30 days"`, `"last 7 days"`, `"this month"`, `"yesterday"`, etc. as `dateRange` value. No custom resolver needed. URL carries the raw token URL-decoded: `?range=last%2030%20days` → `decodeURIComponent` → `"last 30 days"` → pass through to Query.
- For time dimension picking, prefer `cube.dimensions[*]` where `dim.type === 'time'`. Use the first one. If multiple, log a console warning during dev (or surface as a card sub-option later).
- The Try-it button is the call-to-action — make it visually prominent (existing PrimaryBtn pattern from `detail-panel.tsx`).

## Requirements

### Functional

**MetricCard side:**
- Add a `<Footer>` with `Try it` PrimaryBtn (and a "Copy link" secondary button while we're here).
- Try-it builds URL: `/build?cube=<cubeName>&measure=<fqn>&time=<timeFqn>.<granularity>&range=<rangeKey>`.
- Time-dim detection: `cube.dimensions.find(d => d.type === 'time')`. If found: `timeFqn = <timeDim.name>`, granularity defaults to `day`.
- Range defaults to `last_30_days`.
- If no time dim on the cube: button reads `Try it: count` and omits `time`+`range` params. The Builder renders a scalar.
- Copy-link button: copies the current `/metric/...` URL to clipboard (use `navigator.clipboard.writeText`), shows a brief "Copied" inline feedback.

**Builder side:**
- EXTEND the existing `useEffect` at `QueryBuilder.tsx:112-125` (don't add a parallel one).
- Continues to read `cube` param (existing) and apply `selectCube`.
- ADDITIONALLY reads `measure`, `time` (format: `<cubeName>.<dimName>.<granularity>`), `range`.
- When any of `{measure, time, range}` is present, builds a single Cube `Query` object and calls `setQuery(query)` — atomic apply.
- `dateRange` passes the URL-decoded `range` value directly into the Query (Cube SDK accepts native strings).
- All applied params stripped via the existing `replaceState` flow.
- Unknown params silently ignored.
- Reading happens ONCE per meta load — the existing effect dep is `[meta]`. Keep that.

### Non-functional
- URL contract is additive and backwards compatible (existing `?cube=` still works).
- No new dependencies.
- Range dictionary kept in a small util that the Builder + Card share.

## Architecture

```
MetricCard footer
  ├─ <PrimaryBtn "Try it: by log_date, last 30 days">
  │     onClick → build URL → history.push(`/build?cube=...&measure=...&time=...&range=...`)
  └─ <SecondaryBtn "Copy link">
        onClick → navigator.clipboard.writeText(window.location.href)

URL: /build?cube=active_daily&measure=active_daily.dau&time=active_daily.log_date.day&range=last%2030%20days
        │
        ▼
   ExplorePage / QueryBuilderContainer mount
        │
        ▼
   QueryBuilder.tsx existing useEffect (lines 112-125), EXTENDED:
        ├─ wait for meta
        ├─ parse hash params via existing pattern
        ├─ selectCube(params.cube)                                                    [existing]
        ├─ if measure/time/range present:                                              [NEW]
        │     build Query = { measures: [...], timeDimensions: [{ dimension, granularity, dateRange }] }
        │     setQuery(query)
        ├─ replaceState to strip applied params                                        [existing]
        └─ render
```

## Related Code Files

- **Modify:**
  - `src/pages/Catalog/metric-card.tsx` — add footer with Try-it + Copy-link buttons
  - `src/QueryBuilderV2/QueryBuilder.tsx` — mount URL-param reader (~15 LOC)
  - `src/pages/Catalog/detail-panel.tsx:127` — verify existing `?cube=` works end-to-end (no changes if so; align with new reader if not)
- **Create:**
  - `src/pages/Catalog/try-it-url.ts` — small util: `buildTryItUrl({ cube, measure, timeFqn?, granularity?, range? })` returns the URL string. `range` is a Cube native string passed through with URI-encoding (e.g. `"last 30 days"` → `last%2030%20days`). No RANGE_KEYS dictionary.
- **Read for context:**
  - `src/QueryBuilderV2/hooks/query-builder.ts:1417` — `selectCube` API (existing, already invoked)
  - `src/QueryBuilderV2/hooks/query-builder.ts:483` — `setQuery(query: Query)` — the only setter for measures + timeDimensions

## Implementation Steps

1. ~~Verify existing `?cube=` reader~~ — **DONE in validation.** Reader confirmed at `QueryBuilder.tsx:112-125`. Pattern: hash-router parse via `window.location.hash.split('?')[1]`, wait for meta, apply, then `window.history.replaceState`. This phase extends THAT effect.
2. **Create `try-it-url.ts`:**
   - Export `buildTryItUrl({ cube, measure?, timeFqn?, granularity?, range? }): string` — returns `/build?cube=X[&measure=Y][&time=Y.Z.day][&range=last%2030%20days]`. URL-encode `range` only (others are alphanumeric+underscore+dot).
   - No RANGE_KEYS dictionary. Default range constant: `DEFAULT_RANGE = 'last 30 days'`.
3. **Extend the existing QueryBuilder URL reader** at `QueryBuilder.tsx:112-125`:
   - After the existing `selectCube(target)` call, add:
     ```ts
     const measureParam = params.get('measure');
     const timeParam = params.get('time');     // e.g. "active_daily.log_date.day"
     const rangeParam = params.get('range');   // e.g. "last 30 days"
     if (measureParam || timeParam) {
       const query: Query = { measures: measureParam ? [measureParam] : [] };
       if (timeParam) {
         const parts = timeParam.split('.');
         const granularity = parts.length >= 3 ? parts.pop()! : 'day';
         const dimension = parts.join('.');
         query.timeDimensions = [{ dimension, granularity, ...(rangeParam ? { dateRange: rangeParam } : {}) }];
       }
       setQuery(query);
     }
     ```
   - Continue with the existing `params.delete('cube')` strip path; ALSO delete `measure`, `time`, `range`.
4. **Add Try-it footer to MetricCard:**
   - Detect time dim from `cube.dimensions.find(d => d.type === 'time')`.
   - Render label: `Try it: by <shortDimName>, last 30 days` OR `Try it: count` fallback.
   - Click handler: `history.push(buildTryItUrl(...))`.
   - Render Copy-link secondary: `navigator.clipboard.writeText(window.location.origin + '/#' + history.location.pathname)`.
   - "Copied" feedback: brief setState toggle (2s timeout).
5. **Smoke test:**
   - `/metric/active_daily.dau` → click Try-it → land on `/build`, query shows `active_daily.dau` measure + `active_daily.log_date.day` time + last 30 days range, chart renders.
   - `/metric/mf_users.<scalar-only-measure>` → Try-it: count → land on `/build`, scalar shown.
   - Copy-link → paste → matches `/metric/active_daily.dau`.

## Todo List

- [ ] Grep verify `?cube=` URL reader status in QueryBuilder.tsx
- [ ] Create `try-it-url.ts` util with RANGE_KEYS + builder + resolver
- [ ] Extend QueryBuilder URL reader to handle `measure`, `time`, `range`
- [ ] Add Try-it + Copy-link footer to MetricCard
- [ ] Detect time dim with fallback to scalar label
- [ ] Smoke: time-dim measure → chart prefilled
- [ ] Smoke: scalar measure → scalar prefilled
- [ ] Smoke: copy-link round-trip works
- [ ] URL params stripped after apply (history.replace)

## Success Criteria

- [ ] Try-it button on every card builds a valid `/build?...` URL
- [ ] Builder applies all four params (cube, measure, time, range) on mount
- [ ] Unknown params are silently ignored (no crash, no console error)
- [ ] Copy-link copies the card's URL to clipboard with visible feedback
- [ ] Existing `/build?cube=X` use case from `detail-panel.tsx:127` continues to work
- [ ] No state churn — params applied once on mount, then stripped

## Risk Assessment

- **Risk (RESOLVED):** Hash-router param reading — confirmed via validation that `window.location.hash.split('?')[1]` is the working pattern (already in production at `QueryBuilder.tsx:114`).
- **Risk (RESOLVED):** Apply-before-meta-loads — existing effect already has `if (!meta) return` guard; new logic runs inside the same effect, same guard applies.
- **Risk (RESOLVED):** `addTimeDimension` doesn't exist — validation confirmed only `setQuery(query: Query)` is exposed. Phase uses atomic `setQuery({measures, timeDimensions})` instead of multi-setter.
- **Risk:** Clipboard API requires HTTPS or localhost — fine for POC (dev runs on localhost). Document the limit.
- **Risk:** Multiple time dimensions on a cube — first-found may not be the most relevant. For ballistar_vn this is fine (each cube has one obvious time dim); document for future schemas.

## Security Considerations

- URL params are read once and validated against known shape (`cube`, `measure`, `time`, `range`). No raw injection vector — params are passed to typed setters (`selectCube(name: string)`), not interpolated into SQL or HTML.
- Clipboard write is user-initiated (click event). No security concern.
- Range dictionary is closed-set — unknown range key is silently ignored.
