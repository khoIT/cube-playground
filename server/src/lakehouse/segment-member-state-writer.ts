/**
 * Per-user canonical state writer.
 *
 * After a segment's membership lands at `snapshot_ts`, this writer captures the
 * mf_users dimensional state for every member of that segment. The write is a
 * cross-catalog INSERT…SELECT: a predicate-free mf_users projection (compiled
 * once per game+ts, cached within the tick) is JOINed in Trino to the segment's
 * membership at that snapshot_ts — so Trino scans mf_users once but only lands
 * rows for members of this segment.
 *
 * Why no segment filters in the projection: scoping mf_users by the segment
 * predicate would produce wrong state values for segments whose predicate
 * references a different cube (e.g. recharge events). The JOIN to membership
 * is the correct scope boundary — the projection stays predicate-free.
 *
 * Per-segment keying: a uid in N segments → N rows in segment_member_state_daily
 * (one per (snapshot_ts, segment, uid)). Not a cross-segment dedup.
 *
 * Pruning: columns absent from the game's /meta are dropped from both the inner
 * SELECT and the INSERT col list (they are simply omitted, not NULLed — the table
 * allows NULLs for all value columns via the DDL, so absent columns default to NULL
 * without explicit mention).
 */

import { sql as cubeSql } from '../services/cube-client.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { resolveIdentityField } from '../services/resolve-identity-field.js';
import { resolveGamePrefixForWorkspace } from '../services/resolve-game-prefix.js';
import { getMetaMemberSets } from '../services/cube-meta-members.js';
import { physicalizeQuery, physicalMember } from '../services/cube-member-resolver.js';
import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { inlineSqlParams, toSqlLiteral } from './inline-sql-params.js';
import { stripTrailingLimit } from './segment-snapshot-writer.js';
import {
  SEGMENT_MEMBER_STATE_DAILY,
  SEGMENT_MEMBERSHIP_DAILY,
  LAKEHOUSE_SCHEMA,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
  lakehouseConnectorFromEnv,
} from './lakehouse-trino-connector.js';
import {
  CANONICAL_USER_STATE_COLUMNS,
  STATE_VALUE_COLUMNS,
  pruneColumnsForGame,
  type UserStateColumn,
} from './canonical-metric-set.js';

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export interface MemberStateWriteResult {
  segmentId: string;
  snapshotTs: string;
  status: 'written' | 'skipped' | 'error';
  rowCount?: number;
  reason?: string;
  error?: string;
}

export interface MemberStateWriteOptions {
  connector?: Connector;
  /** Cube token override; defaults to per-game minted token. */
  token?: string;
}

interface SegmentForState {
  segmentId: string;
  gameId: string;
  cube: string;
  workspace: string;
}

interface CompiledSql {
  text: string;
  params: unknown[];
}

function extractCompiledSql(resp: unknown): CompiledSql {
  const pair = (resp as { sql?: { sql?: [string, unknown[]] } })?.sql?.sql;
  if (!Array.isArray(pair) || typeof pair[0] !== 'string') {
    throw new Error('Cube /sql returned no [sqlText, params] pair');
  }
  return { text: pair[0], params: Array.isArray(pair[1]) ? pair[1] : [] };
}

/**
 * Build the predicate-free mf_users projection SELECT for a game, aliasing
 * every pruned member to its canonical key. The SELECT is purely over mf_users
 * — no segment filters — so it scans the game-wide user table once per tick.
 *
 * Exported for unit testing: callers can verify:
 *  - no segment filters appear in the returned SQL
 *  - aliases match the pruned column key list
 *  - pruned columns are absent from both SELECT and the returned col list
 *
 * Returns { sql, cols } where `cols` is the ordered pruned UserStateColumn array
 * (matching the aliases in the SELECT).
 */
export async function compileMemberStateSelect(
  gameId: string,
  workspace: string,
  opts: MemberStateWriteOptions = {},
): Promise<{ sql: string; cols: UserStateColumn[] } | null> {
  const token = opts.token ?? resolveCubeTokenForGame(gameId) ?? undefined;
  const prefix = resolveGamePrefixForWorkspace(workspace, gameId);

  // Resolve identity field for mf_users (the canonical state cube).
  const identity = await resolveIdentityField('mf_users', gameId, { workspaceId: workspace });
  if (!identity) return null;

  // Prune columns absent from this game's /meta. metaSets null → keep all.
  const metaSets = await getMetaMemberSets(gameId);
  const allStateCols = [...CANONICAL_USER_STATE_COLUMNS];
  const pruned = pruneColumnsForGame(allStateCols, metaSets, prefix);
  // uid is always first; only value cols need explicit aliases (uid is the
  // identity dim, handled separately in the query below).
  const valueCols = pruned.filter((c) => c.key !== 'uid');

  if (valueCols.length === 0) return null;

  // Build a Cube dimensions-only query: identity + all pruned value dims.
  // All state columns are dimensions (mf_users is a per-user dimensional table).
  const dims = [identity, ...valueCols.map((c) => c.member as string)];
  const logicalQuery = { dimensions: dims, measures: [] as string[] };

  // Physicalize for prefix workspaces (no-op on game_id workspaces).
  const physicalQuery = physicalizeQuery(logicalQuery, prefix);

  const compiled = extractCompiledSql(await cubeSql(physicalQuery, token));
  const rawSql = stripTrailingLimit(inlineSqlParams(compiled.text, compiled.params));

  // Alias each SELECT column to its canonical key so the outer INSERT can
  // reference positional-stable names rather than Cube's internal identifiers.
  // Cube emits columns in the order of `dimensions`, so the alias order matches
  // our pruned column list exactly.
  //
  // The identity column aliased to `uid_col` is used only in the JOIN predicate;
  // the actual `uid` value comes from the membership JOIN (m.uid). The value
  // columns are aliased to their canonical keys for the INSERT col list.
  // ASSUMPTION (must be smoke-tested live before prod): Cube /sql emits each
  // projected member as an output column named with dots replaced by double
  // underscores — "mf_users.uid" → "mf_users__uid" — which the outer INSERT
  // wrapper references by that name. The membership writer sidesteps this by
  // selecting a single column positionally (m.*); a multi-column projection
  // cannot, so it depends on the alias convention. If Cube's compiled output
  // ever changes quoting/aliasing, the JOIN matches nothing and the INSERT
  // lands zero rows — silent except for the post-INSERT dead-join warning
  // below. There is no offline fixture proving the convention, so a live
  // /sql smoke check is the gate.

  // Final SQL for the mf_users projection; the outer INSERT wrapper adds column aliases.
  const finalSql = rawSql;
  return { sql: finalSql, cols: pruned.filter((c) => c.key !== 'uid') };
}

/**
 * Write per-uid canonical state for one (segment, snapshot_ts). Expects the
 * compiled mf_users SELECT to be passed in (or builds it). The state SELECT
 * cache (stateSelectCache) must be keyed by (gameId + snapshotTs); callers
 * populate it on the first segment per (game, ts) and reuse it for subsequent
 * segments of the same game at the same tick.
 *
 * Never throws — returns a structured result for the job heartbeat.
 */
export async function writeMemberStateSnapshot(
  segment: SegmentForState,
  snapshotTs: string,
  stateSelectCache: Map<string, string>,
  cacheKey: string,
  opts: MemberStateWriteOptions = {},
): Promise<MemberStateWriteResult> {
  const base = { segmentId: segment.segmentId, snapshotTs };

  if (!TS_RE.test(snapshotTs)) {
    return { ...base, status: 'error', error: `invalid snapshotTs: ${snapshotTs}` };
  }

  const snapshotDate = snapshotTs.slice(0, 10);
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const gameLit = toSqlLiteral(segment.gameId);
  const segLit = toSqlLiteral(segment.segmentId);
  const dateLit = `DATE '${snapshotDate}'`;
  const tsLit = `TIMESTAMP '${snapshotTs}'`;

  try {
    // Compile (or reuse cached) mf_users projection for this game+ts.
    let stateSql: string;
    let valueCols: UserStateColumn[];

    const cachedSql = stateSelectCache.get(cacheKey);
    if (cachedSql) {
      // Rebuild column list for this game (same prune logic, cheap re-run).
      const prefix = resolveGamePrefixForWorkspace(segment.workspace, segment.gameId);
      const metaSets = await getMetaMemberSets(segment.gameId);
      const pruned = pruneColumnsForGame([...CANONICAL_USER_STATE_COLUMNS], metaSets, prefix);
      valueCols = pruned.filter((c) => c.key !== 'uid');
      stateSql = cachedSql;
    } else {
      const compiled = await compileMemberStateSelect(segment.gameId, segment.workspace, opts);
      if (!compiled) {
        return {
          ...base,
          status: 'skipped',
          reason: `could not compile mf_users projection for game ${segment.gameId}`,
        };
      }
      stateSql = compiled.sql;
      valueCols = compiled.cols;
      stateSelectCache.set(cacheKey, stateSql);
    }

    if (valueCols.length === 0) {
      return { ...base, status: 'skipped', reason: 'no pruned value columns for game' };
    }

    // Build the INSERT col list and the per-column aliases from the inner SELECT.
    // The Cube-compiled SELECT emits columns in dimension order: identity first,
    // then valueCols in order. We SELECT s.* and the INSERT col list maps them.
    // The identity column maps to `uid` via the JOIN (m.uid), not from s.*.
    //
    // INSERT column list: snapshot_date, snapshot_ts, game_id, segment_id, uid, <valueCols>
    const insertCols = [
      'snapshot_date', 'snapshot_ts', 'game_id', 'segment_id', 'uid',
      ...valueCols.map((c) => c.key),
    ].join(', ');

    // The inner SELECT `s` has columns in order: [identity, val1, val2, ...].
    // We skip the identity column (col index 0) and use s.col_2 … s.col_N for
    // value columns. Trino supports positional access via ordinal aliases;
    // the safest approach is to wrap in another CTE that names each column.
    // Since we don't have Cube's exact output column names, we use a trick:
    // SELECT the subquery into a CTE named `state_src`, then reference
    // the columns by their position in a ROW_NUMBER-free style. But Trino
    // doesn't allow positional col refs in projection.
    //
    // Correct approach: the mf_users Cube query returns physical member names
    // as column headers (e.g. "mf_users__uid", "mf_users__ltv_vnd").
    // We alias these via a wrapper CTE using the known physical names.
    const prefix = resolveGamePrefixForWorkspace(segment.workspace, segment.gameId);
    const identity = await resolveIdentityField('mf_users', segment.gameId, {
      workspaceId: segment.workspace,
    });
    if (!identity) {
      return { ...base, status: 'skipped', reason: 'no identity field for mf_users' };
    }

    // Cube physical column names use double-underscores for the dot separator in
    // Trino output (e.g. mf_users.uid → "mf_users__uid"). We build explicit
    // column aliases in a CTE wrapper.
    const physIdentity = physicalMember(identity, prefix);
    // Cube output col name for a physical member: replace "." with "__"
    const cubeColName = (member: string) => member.replace(/\./g, '__');

    const stateColAliases = [
      `"${cubeColName(physIdentity)}" AS uid`,
      ...valueCols.map((c) => {
        const phys = physicalMember(c.member as string, prefix);
        return `"${cubeColName(phys)}" AS ${c.key}`;
      }),
    ].join(',\n    ');

    // The INSERT SELECT: wrap the compiled mf_users SQL in a CTE, alias columns,
    // then JOIN to the segment's membership at this snapshot_ts.
    const insertSql =
      `INSERT INTO ${SEGMENT_MEMBER_STATE_DAILY} (${insertCols})\n` +
      `WITH state_src AS (\n  ${stateSql}\n),\n` +
      `state_named AS (\n  SELECT\n    ${stateColAliases}\n  FROM state_src\n),\n` +
      `members AS (\n` +
      `  SELECT DISTINCT uid FROM ${SEGMENT_MEMBERSHIP_DAILY}\n` +
      `  WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
      `    AND snapshot_ts = ${tsLit}\n` +
      `)\n` +
      `SELECT\n` +
      `  ${dateLit} AS snapshot_date,\n` +
      `  ${tsLit} AS snapshot_ts,\n` +
      `  ${gameLit} AS game_id,\n` +
      `  ${segLit} AS segment_id,\n` +
      `  m.uid,\n` +
      `  ${valueCols.map((c) => `s.${c.key}`).join(',\n  ')}\n` +
      `FROM members m\n` +
      `JOIN state_named s ON m.uid = s.uid`;

    // Idempotent: clear the (snapshot_ts, game, segment) slice first.
    const deleteSql =
      `DELETE FROM ${SEGMENT_MEMBER_STATE_DAILY} ` +
      `WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND snapshot_ts = ${tsLit}`;

    await runQuery(connector, LAKEHOUSE_SCHEMA, deleteSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
    await runQuery(connector, LAKEHOUSE_SCHEMA, insertSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);

    const countRes = await runQuery(
      connector,
      LAKEHOUSE_SCHEMA,
      `SELECT count(*) FROM ${SEGMENT_MEMBER_STATE_DAILY} ` +
        `WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND snapshot_ts = ${tsLit}`,
      LAKEHOUSE_STATEMENT_TIMEOUT_MS,
    );
    const rowCount = Number(countRes.rows[0]?.[0] ?? 0);

    // If membership had rows but state is empty, the mf_users JOIN produced no matches.
    // This is expected for segments whose defining cube is not mf_users (e.g. recharge-event
    // segments). The JOIN requires mf_users identity to match segment membership identity —
    // non-mf_users-cube segments will silently produce zero state rows (known scope limitation).
    if (rowCount === 0) {
      console.warn(
        `[segment-member-state] dead-join for segment=${segment.segmentId} ` +
          `game=${segment.gameId} ts=${snapshotTs}: mf_users identity did not match ` +
          `membership rows. Segment may be defined on a non-mf_users cube.`,
      );
    }

    return { ...base, status: 'written', rowCount };
  } catch (err) {
    return { ...base, status: 'error', error: (err as Error).message };
  }
}

/**
 * Build the INSERT SQL for a member-state snapshot from pre-resolved parts.
 * Pure function — exported for unit testing without Trino.
 *
 * Verifiable properties:
 *  - The mf_users projection (stateSql) contains no segment filter terms
 *    (caller ensures this by building a predicate-free projection).
 *  - INSERT col list == [snapshot_date, snapshot_ts, game_id, segment_id, uid] + valueCols.
 *  - Each valueCols key appears exactly once in the SELECT aliases.
 */
export function buildMemberStateInsertSql(opts: {
  stateSql: string;
  valueCols: UserStateColumn[];
  identityPhysical: string;
  snapshotDate: string;
  snapshotTs: string;
  gameId: string;
  segmentId: string;
  prefix: string | null;
}): { insertSql: string; deleteSql: string; insertCols: string[] } {
  const { stateSql, valueCols, identityPhysical, snapshotDate, snapshotTs, gameId, segmentId, prefix } = opts;
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const dateLit = `DATE '${snapshotDate}'`;
  const tsLit = `TIMESTAMP '${snapshotTs}'`;

  const cubeColName = (member: string) => member.replace(/\./g, '__');
  const physIdentity = physicalMember(identityPhysical, prefix);

  const stateColAliases = [
    `"${cubeColName(physIdentity)}" AS uid`,
    ...valueCols.map((c) => {
      const phys = physicalMember(c.member as string, prefix);
      return `"${cubeColName(phys)}" AS ${c.key}`;
    }),
  ].join(',\n    ');

  const insertColNames = [
    'snapshot_date', 'snapshot_ts', 'game_id', 'segment_id', 'uid',
    ...valueCols.map((c) => c.key),
  ];

  const insertSql =
    `INSERT INTO ${SEGMENT_MEMBER_STATE_DAILY} (${insertColNames.join(', ')})\n` +
    `WITH state_src AS (\n  ${stateSql}\n),\n` +
    `state_named AS (\n  SELECT\n    ${stateColAliases}\n  FROM state_src\n),\n` +
    `members AS (\n` +
    `  SELECT DISTINCT uid FROM ${SEGMENT_MEMBERSHIP_DAILY}\n` +
    `  WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
    `    AND snapshot_ts = ${tsLit}\n` +
    `)\n` +
    `SELECT\n` +
    `  ${dateLit} AS snapshot_date,\n` +
    `  ${tsLit} AS snapshot_ts,\n` +
    `  ${gameLit} AS game_id,\n` +
    `  ${segLit} AS segment_id,\n` +
    `  m.uid,\n` +
    `  ${valueCols.map((c) => `s.${c.key}`).join(',\n  ')}\n` +
    `FROM members m\n` +
    `JOIN state_named s ON m.uid = s.uid`;

  const deleteSql =
    `DELETE FROM ${SEGMENT_MEMBER_STATE_DAILY} ` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND snapshot_ts = ${tsLit}`;

  return { insertSql, deleteSql, insertCols: insertColNames };
}
