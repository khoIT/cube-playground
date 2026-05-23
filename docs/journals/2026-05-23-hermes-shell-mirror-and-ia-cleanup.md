# Hermes Shell Mirror & IA Cleanup — Shipped in Two Commits

**Date**: 2026-05-23 13:41–13:57
**Severity**: High
**Component**: Shell (sidebar, topbar, routing, IA)
**Status**: Resolved
**Branch**: `new_design`

## What Shipped

Two commits landed back-to-back:

1. **166fb43** (feat: Hermes shell mirror) — Ported Hermes' outer chrome (260px sidebar with collapse, 56px sticky topbar, rounded main panel) into cube-playground using inline-style components + hybrid CSS tokens. Hybrid token strategy: cube's `--brand` / `--bg-card` / AntD overrides stay authoritative for Playground/Catalog surfaces; new `--hermes-*` vars in `src/theme/tokens.css` drive `src/shell/*` exclusively. Sidebar IA: Chat / Playground / Data Model / Metrics Catalog / Segments / Advanced (5 sub-items). Collapse and per-section expand state persist in localStorage (`gds-cube:*` prefix). Recent items LRU-8 per module. Topbar trailing slot via `useTopbarTrailing(node, deps, active)` hook. GamePicker in `fixedTrailing` prop so it can't be overwritten. Routes: `/` → `/build`, `/chat` → ChatPlaceholderPage, `/catalog` → `/catalog/data-model`. Phases 1–6 complete; Phases 7–8 scope-trimmed to topbar-trailing adoption only. Phase 9 (Playwright + baselines) deferred. Tests: 694/694 pass.

2. **95e4aef** (fix: IA cleanup) — Removed Advanced sidebar section (Digest, Notifications, Saved views, Workspaces, Identity Map). Routes stay reachable by URL. Identity Map relocated to Settings page. NotificationBell moved into topbar between SearchTrigger and AvatarMenu. Top-level CatalogTabs removed; /catalog/data-model gains Concepts/Cubes/Models subtabs. /catalog/cubes and /catalog/models redirect to subtab paths. Recent items: concept-detail visits now push to `data-model` module (was `metrics-catalog`); new `metrics-catalog` entry for business-metric detail. Tests: 696/696 pass (+2 specs for subtab IA).

## The Brutal Truth

This was a high-velocity ship with real momentum, but the first code-reviewer pass surfaced two **critical bugs in the topbar trailing slot** that shipped to `new_design` and required immediate fix after the first commit. The bugs were subtle enough that local testing didn't catch them — they only appeared under the full KeepAliveRoute + multi-route scenario. The second commit's strict IA cleanup was clean, but the damage was already in place.

The frustrating part: the topbar trailing pattern is the linchpin for this whole shell port. Action bars (+ New segment, Refresh, etc.) now live next to the avatar instead of inline. If that pattern leaks, every page's actions contaminate the topbar. We nearly shipped with cross-route pollution as the default behavior.

## Technical Details

**Bug #1: Cross-Route Leakage in `useTopbarTrailing`**

`KeepAliveRoute` keeps hidden pages mounted under `display:none`. When you visit `/segments/library` and then navigate to `/catalog/data-model`, the library page stays in the DOM. Its `useTopbarTrailing` effect never fired a cleanup because the effect dependency array didn't gate on visibility. Result: the Library actions (checkboxes, edit buttons) stayed rendered in the topbar on every other route until you returned to `/segments`.

```tsx
// Before (wrong)
React.useEffect(() => {
  set(node);  // fires even if page is hidden
  return () => set(null);
}, [...deps]);  // deps don't include active state
```

**Bug #2: GamePicker Overwrite Race**

`<GamePickerMount/>` was rendered *after* children in the trailing context, so its effect fired last and unconditionally overwrote whatever the current page had just registered. On the FIRST visit to a page with actions (e.g., `/segments/detail`), the page's `useTopbarTrailing` effect ran, registered the action bar, then GamePicker's effect ran and clobbered it with the picker dropdown. On SECOND visit, the page was already mounted under KeepAlive so its effect didn't re-run, but GamePicker's did — the page's actions never came back.

**Bug #3: Stale Closure in `DetailTopbarActions`**

`DetailTopbarActions` had `deps: [segmentId]` but the buttons read `uidList.length` and `segment.type`. When you swapped the segment type or added/removed UIDs, the button labels didn't update.

**Fix:**

1. Added `active` boolean gate to `useTopbarTrailing`. Callers must pass `active: useRouteMatch(pattern)` or equivalent. Without the gate, cleanup doesn't fire.
2. Moved GamePicker out of trailing context entirely — now it sits in Topbar's `fixedTrailing` prop so it's never overwritten by per-page registrations.
3. Widened DetailTopbarActions deps to `[segmentId, uidCount, segmentType]`.

## What We Tried

- Local dev navigation across 3–4 routes: passed (KeepAlive doesn't activate in SPA without explicit config).
- E2E mock in the brainstorm (no Playwright at that point): didn't surface the order-of-effects race.
- Code-reviewer read the context structure first, caught the visibility-leak pattern by inspection.

## Root Cause Analysis

Two design oversights:

1. **Invisible components are still live.** KeepAliveRoute is a best practice for perf, but it breaks the "if you can't see it, it doesn't run" assumption. We didn't thread the active-state gate through the trailing hook from day one. The hook should have accepted `active: boolean` as a mandatory parameter, not an optional afterthought.

2. **Effect ordering matters when multiple providers fight for the same state.** GamePicker and per-page trailing actions both wrote to the same context. Rendering GamePicker after children meant its effect always won. The fix (move to `fixedTrailing` prop) sidesteps the problem by letting each consumer own their own slot, but the underlying lesson is: don't hide ordering/priority problems behind shared mutable state. Either one provider per slot, or explicit priority rules.

3. **Dependency closure leaks.** DetailTopbarActions assumed segment.type and uidList were stable inside a `useMemo` — they weren't. The linter caught it on review, but it got past initial testing because segment swaps and UID changes happen on different screens. Wider deps fixed it, but this is a smell that the action bar should have declared its data shape upfront.

## Lessons Learned

- **KeepAlive breaks visibility assumptions.** If you're using KeepAliveRoute or similar, treat every hook as if "this page might be running under display:none right now." Gate side effects on route-match or explicit active flags.
- **Shared mutable state + multiple writers = implicit coupling.** The topbar trailing pattern works now, but only because each writer (GamePicker, per-page actions) has explicit rules. Document those rules in the JSDoc or isolate them at the type level.
- **Test the unhappy path at scale.** We tested one route at a time. Testing with 5 routes and 3 KeepAlive siblings simultaneously would have surfaced the leakage immediately.
- **Code review on structural bugs > linting.** The linter didn't catch order-of-effects or visibility-gate omissions. The human reviewer read the KeepAlive pattern and inferred the risk.

## Next Steps

- **Phase 9 (Playwright + baselines)**: Hermes must boot on port 5173 alongside cube on 3000 for pixel-diff capture. ~600 MB browser install; ~30 min setup. Deferred to follow-up; vitest + typecheck are the regression gates for now. Manual visual smoke recommended before merge to `main`.
- **Recent items display names**: Show segment/cube/metric titles, not raw IDs. Phase 7-deferred. Implement per-module name resolver and lift it above RecentItemPusher in App.tsx.
- **KeepAlive lifecycle audit**: Interval-based side effects (useSegmentLivePolling, useRefreshLogs) stay alive under display:none. Pre-existing issue, but topbar-trailing bug forced it into view. Audit and add explicit lifecycle gates.
- **SidebarSection header click semantics**: Current code both navigates AND toggles expand. Decide: caret-only toggle, or section-header navigation becomes toggle-only, or both with clearer UX hint.
- **Deprecate src/components/Header/ and src/pages/Index/**: Kept on disk one release for safety (avoids breaking lazy-routes-barrel test). Delete after next release.

## Test Posture

- vitest: 694/694 (first commit) → 696/696 (second commit, +2 subtab specs). All pass.
- typecheck: clean in changed files. Pre-existing TS2322 in src/components/Settings/Settings.tsx (unrelated).
- No breaking changes; backward-compatible redirect chains for deprecated routes.

## Emotional Reality

Shipping with bugs stings, but the reviewer's catch-and-fix cycle was fast (review flagged ~2h after the first commit landed). The fix itself is small and solid. The bigger win is that we now have a reliable topbar-trailing pattern that future pages can adopt. The active-gate pattern feels right — it's explicit, forces clarity, and prevents entire categories of KeepAlive-related silently-broken behavior.

The second commit's IA cleanup was clean and surgical. No surprises. That's how you know the first commit needed the fix.
