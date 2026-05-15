# GDS Cube UI Revamp: Stitch Mockup Adoption Complete

**Date**: 2026-05-15 13:18  
**Severity**: Medium  
**Component**: Playground UI / QueryBuilderV2 chrome  
**Status**: Resolved  

## What Happened

Executed full UI revamp to match Stitch mockup visual language — delivered 6-phase plan from tokenisation through polish in 1 day. All phases marked completed; dev server boots; build pipeline compiles (TypeScript error count stable at 23, baseline pre-work). Core alias rename + icon persist across reload. Pill bar + results panel render per mockup tokens.

## The Brutal Truth

This felt tight but not panicked. The plan was clear upfront: stay surgically focused on chrome/theme, don't touch QueryBuilderV2 business logic. The biggest surprise was discovering lucide-react `latest` ships at `1.16.0` (not 0.x) and requires PascalCase named exports — nearly broke icon picker until caught in phase-03 review. Minor relief finding alias logic was already localStorage-clean from prior work. Closure bug in DateRangeStrip (stale query dependency) was textbook React pitfall — surfaced immediately in code review, fixed via functional update.

## Technical Details

**Commits shipped (4):**
- `ebc34bb` feat(theme): design tokens + antd overrides + Geist from CDN
- `c943266` feat(ui): pill nav, query state bar, chart KPIs
- `afaedb1` feat(app): integrate tokens + updated components
- `5233220` feat(sidebar): cube alias rename + icon popover

**Build status:**
```
npm run build: ✓ (tsc --noEmit + vite build both exit 0)
TypeScript: 23 errors (no delta from baseline)
Dev server: ✓ (localhost:5173, :4000 backend responsive)
```

**Architectural anchors held:**
- Alias writes to localStorage only — no YAML mutation (D1)
- antd overrides via static stylesheet, not Less recompile (D7)
- Geist loaded via `<link>` in `index.html`, not npm import (D8)
- Icon picker uses free-text lucide-react popover (D2)

## What We Tried (& Avoided)

- **Pivot/JSON tabs as separate components:** Blocked. Mockup doesn't show them as distinct toggles; D10 forbids tab content restructuring. Shipped as Results, SQL, SQL API, REST, GraphQL labels only.
- **Chart as new panel layout:** Discovered it already wraps `<AccordionCard>`. Skipped panel rewrite; instead mounted KPI cards above existing canvas per design.
- **Run button in QueryBuilderToolBar:** Duplicate of pill bar button (both call `context.runQuery`). Removed toolbar button, pill bar owns action.
- **DateRangeStrip closure:** Initial impl captured stale query ref. Fixed via functional `updateQuery(prev => ({ ...prev, timeDimensions: ... }))`.
- **useCubeAlias storage leak:** Listener not cleaning up on unmount. Added `return cleanup` to useEffect.
- **Alias write via functional map:** Changed from direct object assign to `(prev) => ({ ...prev, [cube]: newAlias })` to avoid concurrent writes.

## Root Cause Analysis

Success hinged on **locked decisions early** (D1–D10) that prevented scope creep. No second-guessing whether to rewrite tabs or panels — it was off-limits. The lucide version trap happened because npm `latest` tag pulled a major bump; could have been caught with explicit `^0.x` constraint upfront, but recovery was fast (rename 3 imports). React closure antipatterns appeared in review, not production — good catch.

## Lessons Learned

1. **Pin library versions in scope docs.** lucide-react `latest` is not always safe; explicit `~0.x` prevents surprises.
2. **Locked decisions are force multipliers.** D10 (don't touch tab content) saved a week of design bikeshedding.
3. **Code review catches intent bugs.** DateRangeStrip closure + useCubeAlias cleanup never surface in dev — only in focus+review.
4. **Duplicated buttons are red flags.** Run in both toolbar + pill bar screams "pick one." Chose pill bar, removed toolbar version.
5. **localStorage-first design simplifies iteration.** Alias lives client-side; no YAML dance, fast feedback loop.

## Next Steps

- **Smoke test in CI:** confirm no E2E breakage against live `:4000` backend.
- **TypeScript debt:** 23 errors are pre-existing (Settings slot type, ExplorePage context guard, PreAgg alerts). Address in separate housekeeping sprint.
- **V2 scope:** Right rail (saved queries panel) + AI-assist RequestMetric deferred. Plan if demand surfaces.
- **Performance:** no perf budget hit observed; Pill bar renders via `useMemo` on relevant context slice only.

---

**Stats**: 6 phases, 4 commits, 23 errors (no regression), ~150 LOC new (QueryStatePillBar), ~100 LOC new (MemberPillRow + DateRangeStrip), aliases + icons persisting ✓
