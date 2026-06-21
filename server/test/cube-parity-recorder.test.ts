/**
 * Tests for cube-parity-recorder.persistRun: run header + findings written,
 * YAML snapshots content-addressed and deduped across runs, refs map cubes to
 * blobs. Uses temp YAML files so blob hashing is deterministic without the
 * live harness / cube-prod clone.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'cube-parity-recorder-test-'));
process.env.DB_PATH = join(tmp, 'test.db');

import { getDb } from '../src/db/sqlite.js';
import { persistRun, type HarnessOutput } from '../src/services/cube-parity-recorder.js';

let db: ReturnType<typeof getDb>;
const fileA = join(tmp, 'a.yml');
const fileB = join(tmp, 'b.yml');

function buildOutput(snapshots: HarnessOutput['snapshots']): HarnessOutput {
  return {
    generatedAt: '2026-06-21T00:00:00.000Z',
    prodRoot: '/does/not/matter',
    games: [{ game: 'cfm' }, { game: 'jus' }],
    counts: { correctness: 1, parity: 2, cosmetic: 3 },
    parseErrors: [],
    snapshots,
    findings: [
      {
        game: 'jus',
        cube: 'role_recharge_daily',
        dimension: 'ratio',
        severity: 'cosmetic',
        devValue: 'arppu_vnd.sql = SUM/COUNT',
        oracleValue: null,
        detail: 'division without double cast',
        file: 'dev/jus/role_recharge_daily.yml',
        line: 127,
        rootCauseKey: 'ratio-truncation:role_recharge_daily.arppu_vnd',
      },
      {
        game: 'cfm',
        cube: 'recharge',
        dimension: 'pk',
        severity: 'correctness',
        devValue: 'primary_key = transaction_id',
        oracleValue: 'primary_key = composite_pk',
        detail: 'pk differs',
        file: 'dev/cfm/recharge.yml',
        line: 72,
        rootCauseKey: 'pk-differs-vs-oracle:recharge',
      },
    ],
  };
}

const META = { startedAt: 1_700_000_000_000, devSha: 'devsha1', prodSha: 'prodsha1' };

beforeAll(() => {
  db = getDb();
  writeFileSync(fileA, 'cubes:\n  - name: a\n');
  writeFileSync(fileB, 'cubes:\n  - name: b\n');
});

afterAll(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec('DELETE FROM cube_yaml_snapshot_ref; DELETE FROM cube_yaml_snapshot; DELETE FROM cube_parity_finding; DELETE FROM cube_parity_run;');
});

const snaps: HarnessOutput['snapshots'] = [
  { side: 'dev', game: 'cfm', cube: 'recharge', path: 'dev/cfm/recharge.yml', absPath: fileA },
  { side: 'prod', game: 'cfm', cube: 'recharge', path: 'oracle/cfm_vn/recharge.yml', absPath: fileB },
];

describe('persistRun', () => {
  it('writes exactly one run row with counts + git shas', () => {
    const r = persistRun(buildOutput(snaps), META);
    const run = db.prepare('SELECT * FROM cube_parity_run WHERE id = ?').get(r.runId) as any;
    expect(run.status).toBe('ok');
    expect(run.count_correctness).toBe(1);
    expect(run.count_parity).toBe(2);
    expect(run.count_cosmetic).toBe(3);
    expect(run.dev_git_sha).toBe('devsha1');
    expect(run.prod_clone_sha).toBe('prodsha1');
    expect(JSON.parse(run.games)).toEqual(['cfm', 'jus']);
    expect(db.prepare('SELECT COUNT(*) c FROM cube_parity_run').get()).toMatchObject({ c: 1 });
  });

  it('writes all findings linked to the run', () => {
    const r = persistRun(buildOutput(snaps), META);
    const rows = db.prepare('SELECT * FROM cube_parity_finding WHERE run_id = ?').all(r.runId) as any[];
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.verdict === null)).toBe(true);
    const pk = rows.find((x) => x.dimension === 'pk');
    expect(pk.oracle_value).toBe('primary_key = composite_pk');
    expect(pk.root_cause_key).toBe('pk-differs-vs-oracle:recharge');
  });

  it('content-addresses snapshots: 2 distinct files → 2 blobs + 2 refs', () => {
    const r = persistRun(buildOutput(snaps), META);
    expect(r.newBlobs).toBe(2);
    expect((db.prepare('SELECT COUNT(*) c FROM cube_yaml_snapshot').get() as any).c).toBe(2);
    expect((db.prepare('SELECT COUNT(*) c FROM cube_yaml_snapshot_ref WHERE run_id = ?').get(r.runId) as any).c).toBe(2);
  });

  it('dedupes unchanged blobs across runs (second identical run stores 0 new blobs)', () => {
    persistRun(buildOutput(snaps), META);
    const r2 = persistRun(buildOutput(snaps), META);
    expect(r2.newBlobs).toBe(0);
    // still only 2 distinct blobs total, but refs accumulate per run
    expect((db.prepare('SELECT COUNT(*) c FROM cube_yaml_snapshot').get() as any).c).toBe(2);
    expect((db.prepare('SELECT COUNT(*) c FROM cube_yaml_snapshot_ref WHERE run_id = ?').get(r2.runId) as any).c).toBe(2);
  });

  it('stores a new blob when a file changes', () => {
    persistRun(buildOutput(snaps), META);
    writeFileSync(fileB, 'cubes:\n  - name: b\n    title: changed\n');
    const r2 = persistRun(buildOutput(snaps), META);
    expect(r2.newBlobs).toBe(1);
    expect((db.prepare('SELECT COUNT(*) c FROM cube_yaml_snapshot').get() as any).c).toBe(3);
  });

  it('deduplicates two cubes sharing one file into a single blob', () => {
    const shared: HarnessOutput['snapshots'] = [
      { side: 'dev', game: 'cfm', cube: 'x', path: 'dev/cfm/x.yml', absPath: fileA },
      { side: 'dev', game: 'cfm', cube: 'y', path: 'dev/cfm/x.yml', absPath: fileA },
    ];
    const r = persistRun(buildOutput(shared), META);
    expect(r.newBlobs).toBe(1);
    expect((db.prepare('SELECT COUNT(*) c FROM cube_yaml_snapshot_ref WHERE run_id = ?').get(r.runId) as any).c).toBe(2);
  });
});
