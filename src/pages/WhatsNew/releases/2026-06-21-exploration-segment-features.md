---
id: exploration-segment-features
title: Explore deeper — segment overlap, heatmap drill-down, and chart compare
date: 2026-06-21
kind: new
area: Segments
deepLink: /segments
image: /whats-new/exploration-segment-features.svg
---
Four new ways to slice, compare, and refine what you're looking at — built on
the surfaces you already use. Pick two cohorts and see exactly where they
overlap, click into a heatmap, overlay two trends on one axis, and refine a
chat answer without re-typing it.

**🔵 Segment overlap & compare**

- Select any two same-game [segments](/segments) and hit **Compare** → a new
  `/segments/compare` view shows the **A-only / both / B-only** split, an
  area-proportional Venn, and the Jaccard index.
- Set math runs on the **nightly membership snapshots**, not a live query, so it
  returns fast. A cohort whose snapshot is more than a day old is flagged stale
  before you trust the numbers.
- **Save any region as its own segment** — the full overlap or difference set
  becomes a manual segment in one click.
- A per-region metric table shows how the three groups differ (avg LTV, active
  days, last seen) — exact for small regions, sampled-and-disclosed for large ones.

**🟧 Heatmap drill-down**

- Heatmap cells in chat are now **clickable** (and keyboard-focusable). Click a
  cell → a popover with its value, its **share of the grid total**, and a
  **"Save this cell as a segment"** hand-off that pre-fills the editor with the
  cell's two-dimension predicate.

**📈 Side-by-side comparison chart**

- When you compare two metrics, chat now draws **one overlaid chart** instead of
  two stacked cards you can't line up — with an **overlaid · grouped · indexed**
  toggle.
- **Indexed** rebases both series to 100 at the start, so a small series stops
  flattening under one that's 10× bigger — you compare *shape*, not magnitude.

**💬 Query refinement in chat**

- Every query result now carries a **refine row**: one-click chips like *change
  the grain*, *add a breakdown*, or *just payers* — plus a free-text box for
  anything else. It re-runs on the same cube without you re-stating the question.

The bell up top will badge new releases as they land.
