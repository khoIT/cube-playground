# Phase 03 — Leaderboard re-skin + trend sparkline

## Context Links
- Design: `design/hifi-mockup.html` (Leaderboard tab section)
- Existing page: `src/pages/DevAudit/skill-leaderboard-page.tsx`
- Existing table: `src/pages/DevAudit/skill-leaderboard-table.tsx`
- Existing hook: `src/pages/DevAudit/use-skill-leaderboard.ts`
- Chat-service endpoint: `chat-service/src/api/debug-leaderboard.ts:34` (unchanged)
- Proxy: `server/src/routes/chat.ts:450` (unchanged)

## Overview
- **Priority:** P2 (cosmetic, no data semantics change)
- **Status:** completed
- **Description:** Re-skin the existing leaderboard to fit the new shell (drop banner+back-link, slot into shell content area). Add a small per-row daily-usage sparkline.

## Key Insights
- No API change. The existing `/debug/leaderboard/skills` already returns per-skill aggregates. Spec asks for "sparkline of trend" — minimal path: compute daily counts from existing data in store, OR keep current API and use bucketed counts already returned. **Decision**: examine `leaderboard-store.ts` first; if no daily bucket → add 7-day bucket subquery to existing store function (zero new endpoint, zero new file in chat-service unless store grows > 200 LOC).
- Re-skin = remove the standalone page chrome (banner with back-link + days select stays, but in slimmer form embedded under tab bar).
- Skill row hover → highlight; click → optionally drill (open session search filtered by skill — phase 06 polish).

## Requirements
**Functional**
- Mount under `/dev/chat-audit/leaderboard` (via shell Switch from phase 01).
- Days filter: 7 / 30 / 90 (kept).
- Each row: skill name · invocations · avg latency · total cost · daily sparkline (7d).
- Empty state: "No skill data in this window."

**Non-functional**
- Each file < 200 LOC.
- No API contract change (BC).

## Architecture
- `SkillLeaderboardPage` becomes a thin tab-content component: drops the standalone banner with back-link, keeps days select + game badge.
- Table re-skinned: T.n200 row dividers, T.fMono for numerics.
- Sparkline = inline SVG component (`skill-trend-sparkline.tsx`), 60px × 18px, T.brand stroke, T.brandSoft fill. No labels.
- Sparkline data source — two options:
  - **A (preferred, KISS)**: existing endpoint returns per-day arrays already? Verify in `leaderboard-store.ts`. If no, extend store to emit `dailyCounts: number[]` (length = days param).
  - **B (no backend touch)**: omit sparkline. Show "—" placeholder per row.
- Decision deferred to implementor after reading `leaderboard-store.ts`. If extending store > 50 LOC, opt B.

## Related Code Files
**Modify**
- `src/pages/DevAudit/skill-leaderboard-page.tsx` — strip standalone chrome, slim to tab-content.
- `src/pages/DevAudit/skill-leaderboard-table.tsx` — add sparkline column; token sweep.
- `chat-service/src/db/leaderboard-store.ts` — IF option A: add `dailyCounts` to row shape. ELSE untouched.

**Create**
- `src/pages/DevAudit/skill-trend-sparkline.tsx` (~50 LOC) — pure SVG, no deps.

## Implementation Steps
1. Read `chat-service/src/db/leaderboard-store.ts:computeSkillLeaderboard` and `src/pages/DevAudit/use-skill-leaderboard.ts`. Decide option A vs B based on existing shape.
2. If A: add `dailyCounts: number[]` to `SkillRow` in leaderboard-store; compute via GROUP BY DATE(started_at). Update FE types in `use-debug-api-types.ts` (or wherever SkillRow is defined). Update proxy is not needed (Fastify passes JSON through).
3. Create `skill-trend-sparkline.tsx`: pure SVG `<polyline>` + area, accepts `values: number[]`, normalizes to 0..max.
4. Update `skill-leaderboard-table.tsx`: add Trend column. Use T.fMono for all numbers (already done — verify).
5. Update `skill-leaderboard-page.tsx`: remove `<Link to="/dev/chat-audit">` back-link and standalone banner. Tab bar from phase 01 supplies navigation. Keep days <select> + game badge but slimmer.
6. Compile.

## Todo List
- [x] Decide option A vs B (read store + hook)
- [x] (A only) Extend `leaderboard-store.ts` with `dailyCounts`
- [x] Create `skill-trend-sparkline.tsx`
- [x] Update `skill-leaderboard-table.tsx` (add trend column + tokens)
- [x] Slim `skill-leaderboard-page.tsx` to tab-content
- [x] Empty state matching mockup
- [x] Compile

## Success Criteria
- Leaderboard renders within new tab shell without double banner.
- Days select still works; URL reloads preserve selection.
- (If A) Sparkline matches hi-fi: thin orange line, mono labels, no axis chrome.
- (If B) Trend column shows "—" gracefully; no broken layout.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Adding `dailyCounts` slows leaderboard endpoint | Low | Low | One extra GROUP BY on existing table; index already exists on (owner+game+started_at-implied) |
| FE SkillRow type drift between hook + table | Med | Low | Single source: extend in `use-skill-leaderboard.ts` types and re-export |
| Sparkline div by zero on all-zero windows | Med | Low | Guard: `max = Math.max(1, ...values)` |

## Security Considerations
- No new endpoint, no new auth surface. Existing ownership join in leaderboard-store unchanged.

## Next Steps
- Phase 06: keyboard nav for tabs, hover-to-drill from skill rows.
