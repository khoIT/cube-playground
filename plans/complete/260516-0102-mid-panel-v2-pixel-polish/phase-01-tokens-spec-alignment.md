---
phase: 1
title: "Tokens & spec alignment"
status: complete
priority: P2
effort: "30m"
dependencies: []
---

# Phase 1: Tokens & spec alignment

## Overview

Add v2-specific design tokens to `src/theme/tokens.css` so later phases can reference variables instead of hardcoded values. Pure additive — no token renames, no breaking changes.

## Requirements

- New tokens for query row, pill, add-button, pre-agg banner, LIVE badge.
- Keep existing tokens untouched (other components depend on them).
- All values come from `plans/reports/researcher-v2-mid-panel-query-card.md`.

## Related Code Files

- Modify: `src/theme/tokens.css`

## Implementation Steps

1. Append a new block under `:root` in `src/theme/tokens.css`:
   ```css
   /* v2 mid-panel tokens (Image #3 reference) */
   --qrow-label-width: 88px;
   --qrow-label-size: 10.5px;
   --qrow-label-spacing: 0.08em;
   --qrow-gap: 14px;
   --qrow-padding-y: 10px;
   --qrow-divider: 1px dashed var(--neutral-100);

   --pill-height: 28px;
   --pill-radius: 8px;
   --pill-padding: 0 8px 0 6px;
   --pill-accent-width: 3px;
   --pill-text-size: 12.5px;
   --pill-mono-size: 10.5px;
   --pill-mono-bg: var(--neutral-100);
   --pill-mono-radius: 4px;
   --pill-mono-padding: 1px 5px;

   --add-pill-height: 28px;
   --add-pill-radius: 8px;
   --add-pill-padding: 0 10px;
   --add-pill-border: rgba(240, 90, 34, 0.4);
   --add-pill-hover-bg: rgba(240, 90, 34, 0.05);
   --add-pill-danger-color: var(--danger);
   --add-pill-danger-border: rgba(220, 38, 38, 0.35);
   --add-pill-danger-hover-bg: #fef2f2;

   --preagg-banner-bg: rgba(240, 90, 34, 0.06);
   --preagg-banner-bg-hover: rgba(240, 90, 34, 0.10);
   --preagg-banner-border: rgba(240, 90, 34, 0.25);
   --preagg-banner-text: #9a3412;

   --live-badge-bg: #d1fae5;
   --live-badge-border: #a7f3d0;
   --live-badge-text: #047857;
   --live-badge-dot: #10b981;
   ```

2. Verify `--danger` still resolves (it does: `#ef4444` at line 45). v2 uses `#dc2626` but our `#ef4444` is close enough; do NOT swap unless visually mismatched in Phase 6.

3. Run `npm run typecheck` and `npx vite build` — token additions should not break anything.

## Success Criteria

- [ ] New tokens appended in `:root` of `tokens.css`
- [ ] Build clean (`npx vite build`)
- [ ] No existing components broken (smoke test: dev server starts, QueryBuilder loads)

## Risk Assessment

Zero risk — additive only. Tokens are unused until Phase 2+ references them.

## Next Steps

→ Phase 2 references `--preagg-banner-*` tokens.
→ Phase 3 references `--qrow-*`, `--pill-*`, `--add-pill-*`, `--live-badge-*` tokens.
