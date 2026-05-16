---
phase: 2
title: "Run row + pre-agg inline"
status: complete
priority: P2
effort: "1h"
dependencies: [1]
---

# Phase 2: Run row + pre-agg inline

## Overview

Move the "Query was not accelerated with pre-aggregation →" pre-agg banner from its current position (separate `AlertsStack` card below the Run card) into the right side of the Run card itself, matching Image #3.

## Requirements

- Single card with Run button + Stop button (when loading) on the left, pre-agg banner + request status on the right.
- Pre-agg banner uses v2 styling: orange-soft chip with underlined text, hover state darkens bg.
- If no pre-agg banner to show, right side falls back to `RequestStatusComponent` (existing).
- QueryBuilderError (separate component) stays below the Run card — it is a different kind of alert (errors, not info).

## Architecture

Current:
```
[Run card]      ← RunControl
[AlertsStack]   ← PreAggregationAlerts + QueryBuilderError
[QueryCard]
[ResultsCard]
```

Target:
```
[Run card]      ← RunControl: Run button | PreAggregationAlerts inline | RequestStatus
[AlertsStack]   ← QueryBuilderError only
[QueryCard]
[ResultsCard]
```

## Related Code Files

- Read for context: `src/QueryBuilderV2/components/PreAggregationAlerts.tsx` (understand current shape)
- Modify: `src/QueryBuilderV2/QueryBuilderToolBar.tsx`
  - `QueryBuilderRunControl`: include `<PreAggregationAlerts inline />` in the right slot
  - `QueryBuilderToolBarAlerts`: remove `<PreAggregationAlerts />`, keep `<QueryBuilderError />`
- Modify: `src/QueryBuilderV2/components/PreAggregationAlerts.tsx`
  - Add optional `inline?: boolean` prop
  - When `inline`, render as a single right-aligned chip (no card wrapper, no margins)
  - Use `--preagg-banner-*` tokens from Phase 1

## Implementation Steps

1. Read `PreAggregationAlerts.tsx` to understand current markup.
2. Add `inline?: boolean` prop. Add an `InlineBanner` styled-component:
   ```tsx
   const InlineBanner = styled.button`
     display: inline-flex;
     align-items: center;
     gap: 8px;
     padding: 8px 14px;
     border-radius: 8px;
     background: var(--preagg-banner-bg);
     border: 1px solid var(--preagg-banner-border);
     color: var(--preagg-banner-text);
     font-family: var(--font-sans);
     font-size: 12.5px;
     text-decoration: underline;
     text-underline-offset: 3px;
     text-decoration-color: rgba(154, 52, 18, 0.4);
     cursor: pointer;
     &:hover { background: var(--preagg-banner-bg-hover); }
   `;
   ```
3. Strip card chrome / margins in inline mode. Preserve click handler (if any) that opens pre-agg docs.
4. In `QueryBuilderToolBar.tsx`, update `RunBandInner` right slot — render `<PreAggregationAlerts inline />` first; if it produces nothing (no pre-agg state), fall through to `RequestStatusComponent`. Use `flex-wrap: wrap` on `RunBandInner` so narrow viewports wrap gracefully.
5. Remove `<PreAggregationAlerts />` from `QueryBuilderToolBarAlerts`. Leave `<QueryBuilderError />`.
6. Verify in dev server: with no run → just Run button shown; after a non-accelerated run → orange banner appears on right; after an accelerated run → green/success indicator (existing RequestStatusComponent behavior).

## Success Criteria

- [ ] Pre-agg banner renders inline right of Run button when applicable
- [ ] No duplicate banner appearing below the card
- [ ] Narrow viewport wraps cleanly (banner drops to a second line, no overflow)
- [ ] QueryBuilderError still shown below the card on errors
- [ ] Existing pre-agg click behavior (if any) preserved
- [ ] `npx vite build` clean

## Risk Assessment

- **Wrap on narrow widths** — `flex-wrap: wrap` on `RunBandInner`. Banner becomes a second row.
- **PreAggregationAlerts may render multiple alerts** — confirm in step 1. If yes, inline mode renders only the first or condenses; document choice.
- **Click behavior** — preserve the original `onClick` / link. The banner is interactive in v2 (underlined, cursor pointer).

## Security Considerations

None.

## Next Steps

→ Phase 3 polishes the Query card directly below.
