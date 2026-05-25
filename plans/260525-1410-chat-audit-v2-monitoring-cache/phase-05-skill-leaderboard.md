# Phase 05 — Skill leaderboard view

## Context Links
- `chat-service/src/db/chat-store.ts:251-294` (`queryStats` — current aggregation pattern; per-skill grouping)
- `chat-service/src/api/debug.ts` (host for new leaderboard route OR new debug-leaderboard.ts)
- `src/pages/DevAudit/dev-audit-page.tsx` (top-nav addition — sequence after phase 04)
- Depends on phase 02 (chat_turns.stop_reason populated)

## Overview
- Priority: P3 (nice-to-have monitoring)
- Status: completed
- Per-skill aggregate dashboard: count, p50/p95 latency, avg/total cost, success rate. Default sorted by p95 latency desc.

## Key Insights
- SQLite has no native PERCENTILE_CONT. Locked choice: compute p50/p95 in Node from the sorted latency array per skill. Simpler than a window-function trick.
- Pre-bucketing per skill: a single SELECT returns all (skill, latency_ms) tuples in the window — group in Node.
- Memory budget: at 5k turns / 10 skills, payload < 1 MB JS array — trivial.

## Requirements

Functional:
- New route: `GET /debug/leaderboard/skills?game=<id>&days=<n>` (default game = all, default days = 30).
- Response shape: `{ skills: SkillRow[], computedAt }` where `SkillRow = { skill, count, p50LatencyMs, p95LatencyMs, avgCostUsd, totalCostUsd, successRate }`.
- New page route `/dev/chat-audit/leaderboard` (`SkillLeaderboardPage`).
- Sortable columns; default sort by p95 latency desc.
- Top-nav link added to `dev-audit-page.tsx` (after phase 04 search bar).

Non-functional:
- Response < 1s for a 30-day window of ~5k turns.
- Successful turn = `stop_reason = 'end_turn'`. Failed = any other or null (predates phase 02).
- Auth: X-Owner-Id required; aggregate is owner-scoped only (never global).

## Architecture

```
GET /debug/leaderboard/skills
   ├─ owner = X-Owner-Id
   ├─ window = now - days*24h
   ├─ SELECT ct.skill, ct.started_at, ct.ended_at, ct.cost_usd, ct.stop_reason
   │   FROM chat_turns ct JOIN chat_sessions cs ON cs.id = ct.session_id
   │   WHERE cs.owner_id = ? AND ct.role = 'assistant'
   │     AND ct.started_at >= ?
   │     AND (game IS NULL OR cs.game_id = ?)
   ├─ in-Node group by skill:
   │   - latencies[] = ended_at - started_at (skip nulls)
   │   - sort ascending → p50 = arr[floor(n*0.5)], p95 = arr[floor(n*0.95)]
   │   - successCount += stop_reason === 'end_turn' ? 1 : 0
   │   - cost sums
   └─ return SkillRow[] sorted by p95 desc

FE:
   /dev/chat-audit/leaderboard route → SkillLeaderboardPage
      ├─ filter bar: gameId (default = active game), days (default 30)
      ├─ sortable table
      └─ link back to /dev/chat-audit
```

## Related Code Files

Modify:
- `chat-service/src/db/migrate.ts` — no schema changes (purely additive query). Skip.
- `chat-service/src/api/debug.ts` — depends on whether we split (recommended: new file given the 200 LOC rule). Recommended: create `debug-leaderboard.ts`.
- `chat-service/src/index.ts` — register the new plugin
- `src/App.tsx` (or wherever routes are defined) — add `/dev/chat-audit/leaderboard` route
- `src/pages/DevAudit/dev-audit-page.tsx` — top-nav link "Leaderboard" (sequenced after phase 04 search bar)

Create:
- `chat-service/src/db/leaderboard-store.ts` — pure SELECT helper + Node-side percentile computation (< 150 LOC)
- `chat-service/src/api/debug-leaderboard.ts` — Fastify plugin (< 100 LOC)
- `src/pages/DevAudit/skill-leaderboard-page.tsx` — main component (< 200 LOC)
- `src/pages/DevAudit/skill-leaderboard-table.tsx` — sortable table (< 150 LOC)
- `src/pages/DevAudit/use-skill-leaderboard.ts` — fetch hook
- `chat-service/src/db/__tests__/leaderboard-percentile.test.ts` — Node-side p50/p95 edge cases (1 row, 2 rows, even counts, nulls)
- `chat-service/src/api/__tests__/debug-leaderboard.test.ts` — owner isolation + window filter

## Implementation Steps

1. **Store**: `leaderboard-store.ts` exports `computeSkillLeaderboard(db, { ownerId, gameId?, days })`. Implementation:
   ```ts
   const sinceMs = Date.now() - days * 24 * 3600 * 1000;
   const rows = db.prepare(`SELECT ct.skill, ct.started_at, ct.ended_at, ct.cost_usd, ct.stop_reason
                            FROM chat_turns ct JOIN chat_sessions cs ON cs.id = ct.session_id
                            WHERE cs.owner_id = ? AND ct.role = 'assistant' AND ct.started_at >= ? ${gameId ? 'AND cs.game_id = ?' : ''}`).all(...);
   // group by skill, compute via percentileSorted helper
   ```
2. **Percentile helper**: `percentileSorted(sortedAsc: number[], p: number): number | null` — null when empty; `arr[Math.floor((arr.length - 1) * p)]` (KISS, exact-rank, no interpolation).
3. **Plugin**: `debug-leaderboard.ts` validates query params (zod), enforces owner header, returns `SkillRow[]` sorted by p95 desc.
4. **FE route**: add `/dev/chat-audit/leaderboard` (react-router). Page reads `useActiveGameId()` for default; surfaces a `<select>` for the days window.
5. **FE table**: sortable header click toggles sort; default sort = p95 desc. Each row: skill name, count, p50, p95, avg cost (cents-precision), total cost, success-rate bar.
6. **Top-nav**: in `dev-audit-page.tsx`, add a small link row above the body. Coordinate with phase 04: this edit follows phase 04 to avoid merge conflicts (sequential, not parallel).

## Todo List

- [x] leaderboard-store + percentile helper + tests
- [x] debug-leaderboard plugin + tests
- [x] FE route + page + table
- [x] Sortable columns
- [x] Top-nav link addition (after phase 04)
- [x] Manual: 30d window over a dev DB renders < 1s

## Success Criteria

- /dev/chat-audit/leaderboard shows ≥ 1 row per skill seen in window
- Default sort is p95 desc; click headers to re-sort
- Switching window (7d/30d/90d) re-fetches
- Sum of `count` ≈ assistant-turn count in window (cross-check)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Percentile edge case (1-row skill) crashes | M | M | Helper returns the only value; unit test covers n=0/1/2/3 |
| Legacy turns (pre phase 02) have null stop_reason → distorts success rate downward | H | M | Surface a "legacy %" badge per skill row (count with stop_reason IS NULL) so user can interpret |
| Query becomes slow at 10k+ turns | L | L | Single index-friendly WHERE; revisit only if needed |
| Top-nav clashes with phase 04 edits to same file | M | L | Sequenced: phase 04 lands first, phase 05 rebases |

## Security Considerations
- Owner-scoped — never returns aggregate across owners.
- Days param bounded server-side: min 1, max 90 (avoid runaway queries).

## Next Steps
- Future: per-game compare view, time-series sparkline per skill.

## Unresolved Questions
None.
