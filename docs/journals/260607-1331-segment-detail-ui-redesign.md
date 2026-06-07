# Segment Detail Page UI Redesign — Overflow & Axes Formatting

**Date**: 2026-06-07 13:31  
**Severity**: Medium  
**Component**: `src/pages/SegmentDetail`, LineChart axes, KPI tiles  
**Status**: DONE — 4 commits staged, tests 393/393, zero regressions

## What Happened

User reported two UX issues in Segment Detail:  
1. KPI value (₫10,286,465,000) overflowed tile, text truncated mid-digit  
2. Chart Y-axes displayed raw ISO datetime (e.g., `2026-04-07T00:00:00.000`) instead of human-readable labels

Created design variants first (huashu-design skill), user selected a hybrid: variant B command-bar styling + variant C KPI tiles. Implemented fixes across both SegmentDetail and Dashboards (chart reuse).

## The Brutal Truth

The overflow issue was embarrassing—literal design debt. Raw KPI numbers should never hit a tile without a compact-format fallback. The ISO axis labels felt like a timezone bug initially; turned out the formatter was absent entirely. Fixing the formatter cascaded to Dashboards because tiles share LineChart—should have caught this in parity review weeks ago.

Design-first workflow (variants → pick → code) avoided rework; UI feedback was crisp and rapid. But the fact that unformatted dates and unbounded numbers shipped to staging tells me QA isn't visually scanning chart axes against production parity.

## Technical Details

**Four commits:**
- `8f0a508`: compact-number utils + KPI tile layout (flex, `min-width: 0` + text truncate)
- `db41ee9`: `format-chart-datetime-label.ts` — regex ISO parser with timezone-safe GMT+7 bounds
- `fe423f1`: Dashboards chart tiles inherit fix (one fix, two surfaces)
- `c19f5e1`: 28 new unit tests (axes, boundaries, year-flip, passthrough)

**Key technical choice:** Datetime formatter uses **regex parse, NOT `new Date()`**. Reason: `new Date('2026-04-07')` assumes UTC and shifts the calendar day in GMT+7 (Asia/Saigon). Regex extracts YYYY-MM-DD safely, no timezone trap. Tests verify year boundaries and short-month labels ("Apr 7, 2026" at year edges; "Apr 7" mid-year).

**Compact numbers:** B-tier format with exact-value title tooltips (users see ₫10.3B on hover, 10,286,465,000 in full). Pure-unit chips (`[users]`/`[VND]`/`[%]`) hidden when redundant with title—reduces visual noise.

**antd 4.16 respectedDropdown overlay API; no v5 Menu props. Per docs/lessons-learned.md entry on antd version pitfalls.

## What We Tried

1. Initial approach: raw number resize + overflow hidden  
   → Rejected: loses precision, users can't read exact value
2. Proposed: always show full numbers with horizontal scroll  
   → Rejected: breaks tile layout, adds UX friction
3. Chosen: compact tier + tooltip precision  
   → Accepted: visual clean, full data on demand

## Root Cause Analysis

1. **Overflow**: No compact-number utility when tile was coded; assumed downstream consumers would handle. Should have enforced a max-value contract in tile props.
2. **Axes**: `LineChart` in Dashboards never had a `tickFormatter`; when copied to SegmentDetail, formatter was still missing. Copy-paste debt + no visual parity checklist.
3. **Timezone in formatter**: Timezone bug waiting to happen; using `new Date()` to parse date strings is a footgun in GMT+7 contexts. Lesson: parse ISO safely, test boundaries.

## Lessons Learned

1. **Chart axis labels are part of spec.** Bare timestamps are not acceptable UX; axis formatting should be required in LineChart contract, not optional.
2. **Parity checklist before reuse.** When a component is copied to a new page, visually audit: colors (tokens?), fonts, spacing, axes/labels, status indicators. A 5-minute checklist before code-review catches these.
3. **Timezone safety: regex > new Date().** In GMT+7 context, never use `new Date(dateString)` to parse ISO. Regex extract or explicit UTC construct—test boundaries.
4. **Compact formats need tooltips.** When numbers shrink for display, always expose full precision on hover. Non-negotiable for financial/metric tiles.

## Next Steps

1. **QA visual-scan checklist.** Before staging sign-off, visually compare chart axes, number formatting, and KPI tile precision against production baseline. Automate with Playwright visual snapshots if feasible.
2. **LineChart contract enforcement.** Document required props (axes labels, tick formatters, units); flag missing formatters in code-review.
3. **Timezone utility library.** Consider extracting `parseISODateSafe()` into a shared utils module if more date parsing emerges (currently only in axes formatter).

**Status:** DONE — Tests 393/393, code-reviewed all-pass, live verified via Playwright. 4 commits staged, ready for merge after lead approval.
