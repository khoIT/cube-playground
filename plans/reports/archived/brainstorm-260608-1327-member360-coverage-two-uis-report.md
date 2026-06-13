# Brainstorm — Member-360 coverage: two UIs (admin + end-user)

## Problem
Per-game 360 coverage signal (`ready / partial / modeled-empty / blocked`) is useless unless two
audiences can see+act on it. Gaps live at one of 3 layers: **Trino table → Cube model/view → product
config**. Action differs per layer, so UI must make "where's the break" legible.

## Decisions (locked via Q&A)
1. **Admin home:** rename **Drift Center → Health Center** hub. Tabs: **Metric drift** (existing
   resolve), **Data coverage** (new), **Detector runs** (existing). Reuses page chrome, role-gating,
   `prefixUnsupported` handling, master–detail shell.
2. **Admin actions (layer-aware, full):**
   - `modeled-empty` → Re-probe · mark expected-empty · link upstream pipeline.
   - `view-not-modeled` → **Scaffold view draft** (reuse metric-coverage draft-scaffolder → `user_360.yml`
     + product-config stub) · open upstream.
   - `trino-table-missing` → File data request (can't fix in-app) · raw-table taxonomy link · mark N/A.
   - Spine UI element: **3-segment chain indicator** (Trino ▸ Cube ▸ Product) per gap, broken link
     highlighted with semantic soft/ink.
3. **End-user — fully blocked:** **disabled chip + tooltip** on Members tab
   (`sample-users-tab.tsx` / `tiered-members-view.tsx`). Plain language, zero Trino/Cube jargon
   ("Profile dashboards aren't available for this game yet"). No big empty-state, no request flow.
4. **End-user — partial:** on the 360 page, **render panels that compute + per-panel "not available
   yet" placeholders** for the rest. Why-it-broke detail stays admin-only (role-gated).

## Approaches considered (summary)
- Admin: A1 tab-in-DriftCenter / A2 new page / **A3 rename-to-Health-Center (chosen)**.
- End-user blocked: **B1 chip+tooltip (chosen)** / B2 empty-state+request / B3 (status quo hide).
- Partial: **render+placeholders (chosen)** / all-or-nothing / single summary note.

## Design constraints (design-guidelines.md)
Tokens only, Inter (`--font-sans`), fixed page-header pattern (24/32 pad, icon+20/700 H1, eyebrow),
semantic soft/ink pills, master–detail + tabs reuse, dark-mode safe. No bespoke hex/spacing.

## Next step
huashu-design hi-fi HTML drafts for: (a) Health Center "Data coverage" tab (list + chain indicator +
layer-aware resolve pane), (b) end-user chip+tooltip + partial-panel placeholders.

## Open questions
1. Health Center rename — keep route `/drift-center` (alias) or move to `/health-center`? Affects nav + bookmarks.
2. Scaffold-draft output target: write to local `cube-dev` working copy vs download/copy stub? (prod path differs.)
3. Does "Data coverage" tab scope to active game (like Metric drift) or show all-games matrix? (Settings section already covers all-games.)
