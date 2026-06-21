/**
 * Records a cross-game Cube parity audit run into segments.db (migration 067).
 *
 * The audit logic lives ONLY in the read-only harness
 * (cube-dev/scripts/audit-cube-parity.mjs). This recorder shells out to it with
 * `--json`, parses the result, and persists the run header, every finding, and
 * a content-addressed snapshot of each inspected YAML — in one transaction.
 * The UI and diff engine read these tables; they never re-implement the diff.
 *
 * YAML blobs are deduped by sha256: a run that re-inspects mostly-unchanged
 * files inserts only the blobs whose content actually changed (INSERT OR IGNORE
 * against the content_hash primary key).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/sqlite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/services → src → server → repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const HARNESS = join(REPO_ROOT, 'cube-dev', 'scripts', 'audit-cube-parity.mjs');

// ─── Harness output contract (mirror of audit-cube-parity.mjs --json) ─────────

export interface HarnessFinding {
  game: string;
  cube: string;
  dimension: string;
  severity: 'correctness' | 'parity' | 'cosmetic';
  devValue: string | null;
  oracleValue: string | null;
  detail?: string;
  file?: string;
  line?: number | null;
  rootCauseKey: string;
}

export interface HarnessSnapshot {
  side: 'dev' | 'prod';
  game: string;
  cube: string;
  path: string;
  absPath: string;
}

export interface HarnessOutput {
  generatedAt: string;
  prodRoot: string;
  games: { game: string }[];
  counts: { correctness: number; parity: number; cosmetic: number };
  parseErrors: unknown[];
  snapshots: HarnessSnapshot[];
  findings: HarnessFinding[];
}

export interface RecordResult {
  runId: number;
  counts: { correctness: number; parity: number; cosmetic: number };
  findingCount: number;
  newBlobs: number;
}

export interface RunMeta {
  startedAt: number;
  devSha: string | null;
  prodSha: string | null;
}

/** `git -C <dir> rev-parse HEAD`, or null if the dir is not a usable repo. */
function gitSha(dir: string): string | null {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function runHarness(prodRoot?: string): HarnessOutput {
  const args = [HARNESS, '--json'];
  if (prodRoot) args.push('--prod-root', prodRoot);
  const stdout = execFileSync('node', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return JSON.parse(stdout) as HarnessOutput;
}

/**
 * Run the harness and persist the run. `prodRoot` overrides the prod-clone
 * location (defaults to the harness's built-in path / CUBE_PARITY_PROD_ROOT).
 */
export function runAndRecord(opts: { prodRoot?: string } = {}): RecordResult {
  const prodRoot = opts.prodRoot ?? process.env.CUBE_PARITY_PROD_ROOT;
  const startedAt = Date.now();
  const db = getDb();

  let out: HarnessOutput;
  try {
    out = runHarness(prodRoot);
  } catch (err) {
    // Persist a failed run header so the UI can show the failure.
    const info = db
      .prepare(
        `INSERT INTO cube_parity_run (started_at, finished_at, status, error_message)
         VALUES (?, ?, 'error', ?)`,
      )
      .run(startedAt, Date.now(), String((err as Error).message ?? err));
    return {
      runId: Number(info.lastInsertRowid),
      counts: { correctness: 0, parity: 0, cosmetic: 0 },
      findingCount: 0,
      newBlobs: 0,
    };
  }

  return persistRun(out, {
    startedAt,
    devSha: gitSha(REPO_ROOT),
    prodSha: gitSha(out.prodRoot),
  });
}

/**
 * Persist a harness output + git metadata into segments.db in one transaction.
 * Separated from runAndRecord so the dedupe/transaction logic is unit-testable
 * against a fixture without shelling out to the harness.
 */
export function persistRun(out: HarnessOutput, meta: RunMeta): RecordResult {
  const db = getDb();
  const games = out.games.map((g) => g.game);

  const tx = db.transaction(() => {
    const runInfo = db
      .prepare(
        `INSERT INTO cube_parity_run
          (started_at, finished_at, status, dev_git_sha, prod_clone_sha, prod_upstream_sha,
           games, count_correctness, count_parity, count_cosmetic, parse_error_count)
         VALUES (?, ?, 'ok', ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(
        meta.startedAt,
        Date.now(),
        meta.devSha,
        meta.prodSha,
        JSON.stringify(games),
        out.counts.correctness,
        out.counts.parity,
        out.counts.cosmetic,
        out.parseErrors.length,
      );
    const runId = Number(runInfo.lastInsertRowid);

    const insFinding = db.prepare(
      `INSERT INTO cube_parity_finding
        (run_id, game, cube, dimension, severity, dev_value, oracle_value, detail, file, line, root_cause_key)
       VALUES (@runId, @game, @cube, @dimension, @severity, @devValue, @oracleValue, @detail, @file, @line, @rootCauseKey)`,
    );
    for (const f of out.findings) {
      insFinding.run({
        runId,
        game: f.game,
        cube: f.cube,
        dimension: f.dimension,
        severity: f.severity,
        devValue: f.devValue ?? null,
        oracleValue: f.oracleValue ?? null,
        detail: f.detail ?? null,
        file: f.file ?? null,
        line: f.line ?? null,
        rootCauseKey: f.rootCauseKey,
      });
    }

    // Snapshot each inspected file once (content-addressed); ref every cube to it.
    const insBlob = db.prepare(
      `INSERT OR IGNORE INTO cube_yaml_snapshot (content_hash, content, byte_length, first_seen_run_id)
       VALUES (?, ?, ?, ?)`,
    );
    const insRef = db.prepare(
      `INSERT INTO cube_yaml_snapshot_ref (run_id, side, game, cube, path, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const fileCache = new Map<string, string>(); // absPath -> content_hash
    let newBlobs = 0;
    for (const s of out.snapshots) {
      let hash = fileCache.get(s.absPath);
      if (!hash) {
        let content: string;
        try {
          content = readFileSync(s.absPath, 'utf8');
        } catch {
          continue; // file vanished between audit and record — skip its ref
        }
        hash = createHash('sha256').update(content).digest('hex');
        fileCache.set(s.absPath, hash);
        const r = insBlob.run(hash, content, Buffer.byteLength(content), runId);
        if (r.changes > 0) newBlobs += 1;
      }
      insRef.run(runId, s.side, s.game, s.cube, s.path, hash);
    }

    return { runId, newBlobs };
  });

  const { runId, newBlobs } = tx();
  return { runId, counts: out.counts, findingCount: out.findings.length, newBlobs };
}
