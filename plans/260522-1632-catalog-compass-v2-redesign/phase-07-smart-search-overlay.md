---
phase: 7
title: "Smart search overlay"
status: done
priority: P3
effort: "3d"
dependencies: [3, 5]
---

# Phase 7: Smart search overlay

## Overview

Global ⌘K NL search overlay. Phase 7 v1 = in-app substring scorer (no backend dep) per Compass mockup. Phase 7 v2 (deferred until Monet-style agent ships) = HTTP/SSE client to the future AI agent service.

## Requirements

**Functional v1:**
- Global keyboard shortcut ⌘K (macOS) / Ctrl+K (Windows/Linux) opens overlay
- Overlay covers viewport with dimmed backdrop; ESC closes
- Search input autofocus on open
- Substring scoring over: business metrics (label/synonyms/description) + concepts (FQN/description) + dashboards (deferred)
- Results grouped by type: Metrics · Concepts · Dashboards
- Click result → navigate to corresponding detail page
- Keyboard nav: ↑/↓ select, Enter open
- "P4-reserved slot" banner at bottom (per Compass §5.3) for future multi-step agent

**Functional v2 (deferred):**
- Overlay POSTs query to Monet-style endpoint
- Streams SSE events: `match`, `snippet`, `open-route`
- Renders progressive results

**Non-functional:**
- Open within 50ms (no API call v1)
- Scoring across 100+ entries < 16ms

## Architecture

```
src/shared/smart-search/
├── smart-search-provider.tsx       # NEW — Context: open state, query, results
├── smart-search-overlay.tsx        # NEW — modal/portal UI
├── smart-search-trigger.ts         # NEW — keyboard hook
├── search-scorer.ts                # NEW — v1 substring + weighted score
├── search-result-groups.tsx        # NEW — grouped result list
├── search-result-row.tsx           # NEW — single row
├── search-types.ts                 # NEW — SearchResult union
└── __tests__/...

src/App.tsx (or root)
└── wrap in <SmartSearchProvider>; mount <SmartSearchOverlay/>
```

**Scoring weights** (per Compass `searchConcepts()`):
- label exact: 1.0
- label prefix: 0.8
- synonym match: 0.7
- description substring: 0.3
- type icon boost: + 0.05 for measure, etc.

**v2 placeholder:** `search-scorer.ts` exports a `SearchEngine` interface. v1 impl = `LocalSubstringEngine`. v2 = `MonetSseEngine` plugged into same interface. No call-site changes when v2 ships.

## Related Code Files

**Create:** ~8 files

**Modify:**
- `src/App.tsx` (or root layout) — wrap in provider + mount overlay
- `src/pages/Catalog/metrics-tab/metrics-search-row.tsx` — "Smart search" ghost button opens overlay (replace stub from P3)
- `src/pages/Catalog/data-model-tab/data-model-search-row.tsx` — same

## Implementation Steps

1. **Build `SmartSearchProvider`** — context exposing `{ isOpen, query, setQuery, results, open, close, focus }`.
2. **Build `smart-search-trigger`** — useEffect hook for `keydown` listener (⌘K/Ctrl+K). Skip when input/textarea focused unless modifier present.
3. **Build `LocalSubstringEngine`** — pure function `score(query, items)` returns `SearchResult[]`. Hand-tune weights per Compass.
4. **Build overlay UI** — portal-rendered, full-screen dim, centred search box (60% width), grouped results below. Esc closes; click backdrop closes.
5. **Wire result navigation** — Enter or click on result calls `nav(result.routeTo)` + closes overlay.
6. **Add bottom banner** — small "Coming in v2: multi-step agent" hint with monet icon (per Compass §5.3).
7. **Wire trigger button** in P3/P5 search rows — `useSmartSearch().open()`.
8. **Test:**
   - Keyboard: ⌘K opens; ESC closes; arrows navigate; Enter selects
   - Scoring: "arpu_daily" returns ARPDAU first; "revenue_vnd" returns concept then metric
   - Empty query shows recently-viewed (small local list)

## Success Criteria

- [ ] ⌘K opens overlay anywhere in app
- [ ] Substring search finds metrics by synonym
- [ ] Substring search finds concepts by FQN
- [ ] Click result navigates to detail page
- [ ] Keyboard nav works (↑/↓/Enter/ESC)
- [ ] "Smart search" button in Metrics + Data Model tabs opens overlay
- [ ] Bottom v2 banner visible
- [ ] Overlay open time < 50ms on dev machine

## Risk Assessment

- **Keyboard shortcut conflicts** with browser ⌘K (focus address bar) — handled by `preventDefault` only when overlay is appropriate context. **Mitigation:** add small inline help "Press ⌘K from anywhere in Catalog".
- **Substring scoring quality vs embeddings** (open Q for v2). **Mitigation:** v1 ships hand-tuned weights from Compass; v2 swaps engine.
- **Mounting at App root may not exist** if app uses different shell. **Mitigation:** scout for highest-level layout component during implementation.
- **Recently-viewed list** needs localStorage — keep small (last 10) + namespace key.
- **v2 dependency** on Monet-style agent — out of this phase's scope; document interface contract so v2 wire is plug-and-play.
