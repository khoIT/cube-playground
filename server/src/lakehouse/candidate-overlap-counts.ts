/**
 * Approximate overlap between a NOT-YET-SAVED candidate cohort and the caller's
 * existing saved segments in the same game.
 *
 * A candidate has no snapshot row in SEGMENT_MEMBERSHIP_DAILY, so this path
 * approximates the intersection by:
 *   1. Fetching a bounded sample (≤ MAX_CANDIDATE_SAMPLE) of candidate uids from
 *      Cube via the identity-dim + filters query (same shape as compute-segment-size,
 *      but with an explicit LIMIT rather than `total:true` so we get actual uid rows).
 *   2. Inlining those uids as a VALUES list inside a Trino SQL that intersects them
 *      against the latest-partition snapshot membership for each of the caller's
 *      same-game saved segments.
 *
 * Why approximate? The Cube sample is a bounded prefix, not the full cohort.
 * `pct_of_candidate` = both_count / sample_size; it is consistent within the
 * sample but slightly biased if membership isn't uniform across the cursor order.
 * Every response MUST carry `approx: true` — this is non-negotiable.
 *
 * Why not materialize the candidate first?
 * Materialization requires a real segment id, a Trino INSERT into the snapshot
 * table, and scheduler coordination — too expensive and too coupled for a live,
 * non-blocking novelty check. The sample-vs-snapshot approximation is the
 * deliberate trade-off (see docs/lessons-learned.md category: segment sprawl).
 */

import { toSqlLiteral } from './inline-sql-params.js';
import { SEGMENT_MEMBERSHIP_DAILY } from './lakehouse-trino-connector.js';
import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import type { TrinoResult } from '../services/trino-rest-client.js';

/** Max uids inlined in the VALUES list. Trino's SQL plan parser handles ~10k
 *  values comfortably; we cap lower to bound query compilation time. */
export const MAX_CANDIDATE_SAMPLE = 5_000;

/** Only surface overlaps above this fraction to avoid noise. */
export const MIN_OVERLAP_PCT = 0.25;

/** Return at most this many overlap hits (sorted desc by pct). */
export const TOP_K = 3;

export interface CandidateOverlapRow {
  segment_id: string;
  name: string;
  candidate_size: number;
  both_count: number;
  pct_of_candidate: number;
}

/**
 * Build the Trino SQL that counts, per saved segment_id, how many uids from
 * `candidateUids` appear in the latest snapshot partition.
 *
 * The candidate uid VALUES list is inlined directly — safe because it comes from
 * Cube's own response (server-controlled), not from an external caller's input.
 * The `segmentIds` list originates from the SQLite segments table, also server-
 * owned. Neither surface is injection-prone; we still quote them properly via
 * `toSqlLiteral` for correctness (apostrophes in segment ids would break SQL).
 *
 * Latest-partition resolution mirrors `overlapCtePrefix` from segment-overlap-counts:
 *   max(snapshot_date) → then max(snapshot_ts) within that date. DISTINCT uid
 *   collapses any multi-row identity duplicates before the intersection count.
 */
export function buildCandidateOverlapSql(opts: {
  gameId: string;
  segmentIds: string[];
  candidateUids: string[];
}): string {
  const { gameId, segmentIds, candidateUids } = opts;
  if (segmentIds.length === 0 || candidateUids.length === 0) {
    // Caller should short-circuit before this, but guard anyway.
    return `SELECT NULL AS segment_id, 0 AS both_count WHERE 1=0`;
  }

  const gameLit = toSqlLiteral(gameId);
  const segIdList = segmentIds.map(toSqlLiteral).join(', ');

  // Inline candidate uids as a single-column VALUES table (sample_uids(uid)).
  // Cap defensively — caller is responsible for pre-capping, but double-guard.
  const cappedUids = candidateUids.slice(0, MAX_CANDIDATE_SAMPLE);
  const uidValues = cappedUids.map((u) => `(${toSqlLiteral(u)})`).join(',\n  ');

  return (
    `WITH sample_uids(uid) AS (\n` +
    `  VALUES\n  ${uidValues}\n),\n` +
    `scoped AS (\n` +
    `  SELECT segment_id, uid, snapshot_date, snapshot_ts\n` +
    `  FROM ${SEGMENT_MEMBERSHIP_DAILY}\n` +
    `  WHERE game_id = ${gameLit} AND segment_id IN (${segIdList})\n` +
    `),\n` +
    `maxdate AS (\n` +
    `  SELECT segment_id, max(snapshot_date) AS d FROM scoped GROUP BY segment_id\n` +
    `),\n` +
    `latest_date AS (\n` +
    `  SELECT s.segment_id, s.uid, s.snapshot_ts\n` +
    `  FROM scoped s JOIN maxdate m ON s.segment_id = m.segment_id AND s.snapshot_date = m.d\n` +
    `),\n` +
    `maxts AS (\n` +
    `  SELECT segment_id, max(snapshot_ts) AS ts FROM latest_date GROUP BY segment_id\n` +
    `),\n` +
    `members AS (\n` +
    `  SELECT DISTINCT l.segment_id, l.uid\n` +
    `  FROM latest_date l JOIN maxts x ON l.segment_id = x.segment_id\n` +
    `  WHERE x.ts IS NULL OR l.snapshot_ts = x.ts\n` +
    `)\n` +
    `SELECT m.segment_id, count(*) AS both_count\n` +
    `FROM members m\n` +
    `WHERE m.uid IN (SELECT uid FROM sample_uids)\n` +
    `GROUP BY m.segment_id`
  );
}

/** Injectable deps for unit-testability (no real Trino/Cube in tests). */
export interface CandidateOverlapDeps {
  runQueryFn?: (connector: Connector, schema: string, sql: string, timeoutMs?: number) => Promise<TrinoResult>;
}

/**
 * Given the candidate uid sample and the set of saved segments (each with an id +
 * name), return per-segment overlap counts.
 *
 * `candidateSize` is the sample length — it IS the denominator for pct_of_candidate.
 * Rankings are sorted descending by pct and capped to TOP_K.
 * Segments below MIN_OVERLAP_PCT are excluded.
 *
 * On any error this returns an empty array so the caller can surface a best-effort
 * result without propagating failures to the UI.
 */
export async function computeCandidateOverlap(
  connector: Connector,
  schema: string,
  opts: {
    gameId: string;
    savedSegments: Array<{ id: string; name: string }>;
    candidateUids: string[];
    timeoutMs?: number;
  },
  deps: CandidateOverlapDeps = {},
): Promise<CandidateOverlapRow[]> {
  const { gameId, savedSegments, candidateUids, timeoutMs } = opts;
  const runQueryFn = deps.runQueryFn ?? runQuery;

  if (candidateUids.length === 0 || savedSegments.length === 0) return [];

  const cappedUids = candidateUids.slice(0, MAX_CANDIDATE_SAMPLE);
  const candidateSize = cappedUids.length;

  const sql = buildCandidateOverlapSql({
    gameId,
    segmentIds: savedSegments.map((s) => s.id),
    candidateUids: cappedUids,
  });

  let result: TrinoResult;
  try {
    result = await runQueryFn(connector, schema, sql, timeoutMs);
  } catch {
    // Swallow: snapshot may not exist yet, Trino may be down, timeout. Non-blocking.
    return [];
  }

  // Build a lookup from segment_id → both_count from the Trino rows.
  // Column order: segment_id (index 0), both_count (index 1) as per the SQL above.
  const countById = new Map<string, number>();
  for (const row of result.rows) {
    const segId = row[0] != null ? String(row[0]) : null;
    const count = row[1] != null ? Number(row[1]) : 0;
    if (segId) countById.set(segId, Number.isFinite(count) ? count : 0);
  }

  // Build name lookup from savedSegments.
  const nameById = new Map(savedSegments.map((s) => [s.id, s.name]));

  const rows: CandidateOverlapRow[] = [];
  for (const [segId, bothCount] of countById.entries()) {
    if (bothCount === 0) continue;
    const pct = bothCount / candidateSize;
    if (pct < MIN_OVERLAP_PCT) continue;
    rows.push({
      segment_id: segId,
      name: nameById.get(segId) ?? segId,
      candidate_size: candidateSize,
      both_count: bothCount,
      pct_of_candidate: pct,
    });
  }

  // Sort descending by pct, return top K.
  rows.sort((a, b) => b.pct_of_candidate - a.pct_of_candidate);
  return rows.slice(0, TOP_K);
}
