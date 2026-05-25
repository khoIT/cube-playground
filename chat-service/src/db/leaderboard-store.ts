/**
 * Leaderboard store: per-skill aggregates over a rolling time window.
 *
 * Computes p50/p95 latency in Node (SQLite has no PERCENTILE_CONT).
 * Single SELECT returns (skill, started_at, ended_at, cost_usd, stop_reason)
 * for all assistant turns in the window, then groups in memory.
 *
 * Memory budget: at 10k turns / 10 skills, < 1 MB array — trivial.
 */

import type Database from 'better-sqlite3';

export interface SkillRow {
  skill: string;
  count: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  avgCostUsd: number | null;
  totalCostUsd: number;
  successRate: number | null;
  /** How many turns have null stop_reason (pre-phase-02 legacy). */
  legacyCount: number;
  /**
   * Daily turn counts for the requested window, length = days param.
   * Index 0 = oldest day (floor(sinceMs / 86400000)), last index = today.
   * Zero-filled for days with no activity. Useful for sparkline rendering.
   */
  dailyCounts: number[];
}

interface RawTurnRow {
  skill: string | null;
  started_at: number;
  ended_at: number | null;
  cost_usd: number | null;
  stop_reason: string | null;
}

/**
 * KISS exact-rank percentile on a pre-sorted ascending array.
 * Returns null on empty array, the sole value on single-element arrays.
 */
export function percentileSorted(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  return sortedAsc[Math.floor((sortedAsc.length - 1) * p)];
}

interface LeaderboardParams {
  ownerId: string;
  gameId?: string;
  /** Clamped to [1, 90] server-side. */
  days: number;
}

/**
 * Returns per-skill aggregates sorted by p95 latency descending (nulls last).
 */
export function computeSkillLeaderboard(
  db: Database.Database,
  { ownerId, gameId, days }: LeaderboardParams,
): SkillRow[] {
  // Clamp days to [1, 90] — avoid runaway queries
  const clampedDays = Math.max(1, Math.min(90, days));
  const sinceMs = Date.now() - clampedDays * 24 * 3600 * 1000;

  const sql = gameId
    ? `SELECT ct.skill, ct.started_at, ct.ended_at, ct.cost_usd, ct.stop_reason
       FROM chat_turns ct
       JOIN chat_sessions cs ON cs.id = ct.session_id
       WHERE cs.owner_id = ? AND ct.role = 'assistant' AND ct.started_at >= ?
         AND cs.game_id = ?`
    : `SELECT ct.skill, ct.started_at, ct.ended_at, ct.cost_usd, ct.stop_reason
       FROM chat_turns ct
       JOIN chat_sessions cs ON cs.id = ct.session_id
       WHERE cs.owner_id = ? AND ct.role = 'assistant' AND ct.started_at >= ?`;

  const rawRows = gameId
    ? (db.prepare(sql).all(ownerId, sinceMs, gameId) as RawTurnRow[])
    : (db.prepare(sql).all(ownerId, sinceMs) as RawTurnRow[]);

  // Compute day buckets anchored to TODAY so the last index is always clampedDays-1.
  // dayIdx = clampedDays - 1 - (todayDayNum - turnDayNum)
  // This is invariant: regardless of where within the UTC day we are,
  // today → index clampedDays-1, yesterday → clampedDays-2, etc.
  const MS_PER_DAY = 86_400_000;
  const todayDayNum = Math.floor(Date.now() / MS_PER_DAY);

  // Group by skill (null skill → group as "(unknown)")
  const groups = new Map<string, {
    latencies: number[];
    costs: number[];
    successCount: number;
    legacyCount: number;
    total: number;
    /** Sparse map: dayIndex (0..clampedDays-1) → count */
    dayCounts: Map<number, number>;
  }>();

  for (const row of rawRows) {
    const key = row.skill ?? '(unknown)';
    if (!groups.has(key)) {
      groups.set(key, { latencies: [], costs: [], successCount: 0, legacyCount: 0, total: 0, dayCounts: new Map() });
    }
    const g = groups.get(key)!;
    g.total++;

    // Bucket into day index: today → clampedDays-1, yesterday → clampedDays-2, …
    const turnDayNum = Math.floor(row.started_at / MS_PER_DAY);
    const dayIdx = clampedDays - 1 - (todayDayNum - turnDayNum);
    if (dayIdx >= 0 && dayIdx < clampedDays) {
      g.dayCounts.set(dayIdx, (g.dayCounts.get(dayIdx) ?? 0) + 1);
    }

    // Latency: only when both timestamps present
    if (row.started_at != null && row.ended_at != null) {
      const ms = row.ended_at - row.started_at;
      if (ms >= 0) g.latencies.push(ms);
    }

    if (row.cost_usd != null) g.costs.push(row.cost_usd);

    if (row.stop_reason === null) {
      g.legacyCount++;
    } else if (row.stop_reason === 'end_turn') {
      g.successCount++;
    }
  }

  const result: SkillRow[] = [];

  for (const [skill, g] of groups) {
    g.latencies.sort((a, b) => a - b);
    const totalCostUsd = g.costs.reduce((s, c) => s + c, 0);
    const avgCostUsd = g.costs.length > 0 ? totalCostUsd / g.costs.length : null;

    // Success rate only over turns with known stop_reason (exclude legacy nulls)
    const scorable = g.total - g.legacyCount;
    const successRate = scorable > 0 ? g.successCount / scorable : null;

    // Expand sparse dayCounts into zero-filled length-clampedDays array
    const dailyCounts = Array.from({ length: clampedDays }, (_, i) => g.dayCounts.get(i) ?? 0);

    result.push({
      skill,
      count: g.total,
      p50LatencyMs: percentileSorted(g.latencies, 0.5),
      p95LatencyMs: percentileSorted(g.latencies, 0.95),
      avgCostUsd,
      totalCostUsd,
      successRate,
      legacyCount: g.legacyCount,
      dailyCounts,
    });
  }

  // Sort by p95 desc, nulls last
  result.sort((a, b) => {
    if (a.p95LatencyMs === null && b.p95LatencyMs === null) return 0;
    if (a.p95LatencyMs === null) return 1;
    if (b.p95LatencyMs === null) return -1;
    return b.p95LatencyMs - a.p95LatencyMs;
  });

  return result;
}
