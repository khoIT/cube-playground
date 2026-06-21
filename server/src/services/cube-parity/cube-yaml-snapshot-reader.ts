/**
 * Read-side accessors over the persisted parity-audit tables (migration 067).
 *
 * The recorder writes one content-addressed YAML blob per distinct file content
 * and a per-run ref linking each (side, game, cube) to its blob. These helpers
 * pull blobs and version timelines back out so the diff engine never has to
 * touch the live filesystem or git — the persisted snapshots are the durable
 * record that survives even when the working tree has moved on.
 *
 * Pure SQL with `db` injection (no getDb here) so it's testable against :memory:.
 */

import type Database from 'better-sqlite3';

export interface RunHeader {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  devGitSha: string | null;
  prodCloneSha: string | null;
  prodUpstreamSha: string | null;
  games: string[];
  countCorrectness: number;
  countParity: number;
  countCosmetic: number;
  parseErrorCount: number;
  errorMessage: string | null;
}

export interface FindingRow {
  id: number;
  game: string;
  cube: string;
  dimension: string;
  severity: string;
  devValue: string | null;
  oracleValue: string | null;
  detail: string | null;
  file: string | null;
  line: number | null;
  verdict: string | null;
  rootCauseKey: string;
}

/** One point on a cube's dev-YAML history: the run where this content was seen. */
export interface CubeVersion {
  runId: number;
  startedAt: number;
  contentHash: string;
  byteLength: number;
  /** true when this content differs from the immediately-previous version. */
  changed: boolean;
}

interface RawRun {
  id: number;
  started_at: number;
  finished_at: number | null;
  status: string;
  dev_git_sha: string | null;
  prod_clone_sha: string | null;
  prod_upstream_sha: string | null;
  games: string;
  count_correctness: number;
  count_parity: number;
  count_cosmetic: number;
  parse_error_count: number;
  error_message: string | null;
}

function mapRun(r: RawRun): RunHeader {
  let games: string[] = [];
  try {
    games = JSON.parse(r.games) as string[];
  } catch {
    games = [];
  }
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    devGitSha: r.dev_git_sha,
    prodCloneSha: r.prod_clone_sha,
    prodUpstreamSha: r.prod_upstream_sha,
    games,
    countCorrectness: r.count_correctness,
    countParity: r.count_parity,
    countCosmetic: r.count_cosmetic,
    parseErrorCount: r.parse_error_count,
    errorMessage: r.error_message,
  };
}

export function listRuns(db: Database.Database, limit = 50): RunHeader[] {
  const rows = db
    .prepare('SELECT * FROM cube_parity_run ORDER BY started_at DESC, id DESC LIMIT ?')
    .all(limit) as RawRun[];
  return rows.map(mapRun);
}

export function getRun(db: Database.Database, runId: number): RunHeader | null {
  const row = db.prepare('SELECT * FROM cube_parity_run WHERE id = ?').get(runId) as RawRun | undefined;
  return row ? mapRun(row) : null;
}

/** Newest 'ok' run id, or null when none recorded. */
export function latestOkRunId(db: Database.Database): number | null {
  const row = db
    .prepare("SELECT id FROM cube_parity_run WHERE status = 'ok' ORDER BY started_at DESC, id DESC LIMIT 1")
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function listFindings(db: Database.Database, runId: number): FindingRow[] {
  const rows = db
    .prepare('SELECT * FROM cube_parity_finding WHERE run_id = ? ORDER BY severity, game, cube')
    .all(runId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    game: r.game as string,
    cube: r.cube as string,
    dimension: r.dimension as string,
    severity: r.severity as string,
    devValue: (r.dev_value as string) ?? null,
    oracleValue: (r.oracle_value as string) ?? null,
    detail: (r.detail as string) ?? null,
    file: (r.file as string) ?? null,
    line: (r.line as number) ?? null,
    verdict: (r.verdict as string) ?? null,
    rootCauseKey: r.root_cause_key as string,
  }));
}

/**
 * Fetch the persisted YAML text for one (run, side, game, cube). Returns the
 * blob content + its path, or null when that side wasn't snapshotted (e.g. a
 * dev-only cube has no 'prod' ref).
 */
export function getSnapshotContent(
  db: Database.Database,
  runId: number,
  side: 'dev' | 'prod',
  game: string,
  cube: string,
): { content: string; path: string; contentHash: string } | null {
  const row = db
    .prepare(
      `SELECT s.content AS content, r.path AS path, r.content_hash AS hash
         FROM cube_yaml_snapshot_ref r
         JOIN cube_yaml_snapshot s ON s.content_hash = r.content_hash
        WHERE r.run_id = ? AND r.side = ? AND r.game = ? AND r.cube = ?
        LIMIT 1`,
    )
    .get(runId, side, game, cube) as { content: string; path: string; hash: string } | undefined;
  return row ? { content: row.content, path: row.path, contentHash: row.hash } : null;
}

/** One dev cube inspected in a run + whether it had a prod-clone counterpart. */
export interface RunCube {
  game: string;
  cube: string;
  hasProd: boolean;
}

/**
 * Every dev cube snapshotted in a run, tagged with whether a prod counterpart
 * was also snapshotted. Lets the heatmap render the full grid — clean cells and
 * hatched no-counterpart cells included — not just cubes that produced findings.
 */
export function listRunCubes(db: Database.Database, runId: number): RunCube[] {
  const rows = db
    .prepare(
      `SELECT d.game AS game, d.cube AS cube,
              EXISTS(
                SELECT 1 FROM cube_yaml_snapshot_ref p
                 WHERE p.run_id = d.run_id AND p.side = 'prod'
                   AND p.game = d.game AND p.cube = d.cube
              ) AS hasProd
         FROM cube_yaml_snapshot_ref d
        WHERE d.run_id = ? AND d.side = 'dev'
        ORDER BY d.cube, d.game`,
    )
    .all(runId) as Array<{ game: string; cube: string; hasProd: number }>;
  return rows.map((r) => ({ game: r.game, cube: r.cube, hasProd: r.hasProd === 1 }));
}

/**
 * Dev-side version timeline for one cube across all recorded runs (oldest→newest).
 * `changed` marks runs whose content differs from the prior one — the history
 * picker shows these as the meaningful version boundaries.
 */
export function listCubeVersions(db: Database.Database, game: string, cube: string): CubeVersion[] {
  const rows = db
    .prepare(
      `SELECT r.run_id AS runId, run.started_at AS startedAt,
              r.content_hash AS contentHash, s.byte_length AS byteLength
         FROM cube_yaml_snapshot_ref r
         JOIN cube_parity_run run ON run.id = r.run_id
         JOIN cube_yaml_snapshot s ON s.content_hash = r.content_hash
        WHERE r.side = 'dev' AND r.game = ? AND r.cube = ?
        ORDER BY run.started_at ASC, r.run_id ASC`,
    )
    .all(game, cube) as Array<{ runId: number; startedAt: number; contentHash: string; byteLength: number }>;
  let prevHash: string | null = null;
  return rows.map((row) => {
    const changed = prevHash !== null && prevHash !== row.contentHash;
    prevHash = row.contentHash;
    return { ...row, changed };
  });
}
