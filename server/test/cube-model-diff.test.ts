/**
 * Diff-engine tests: pure structured/text diff + prefix-tolerant cube extraction,
 * and the DB-backed orchestrator (dev↔prod + version↔version) driven through the
 * real recorder + snapshot reader against a temp segments.db.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'cube-model-diff-test-'));
process.env.DB_PATH = join(tmp, 'test.db');

import { getDb } from '../src/db/sqlite.js';
import { persistRun, type HarnessOutput } from '../src/services/cube-parity-recorder.js';
import { diffDevVsProd, diffDevVersions, listCubeVersions } from '../src/services/cube-model-diff.js';
import {
  extractCubeShape,
  structuredDiff,
  unifiedTextDiff,
} from '../src/services/cube-parity/cube-yaml-structured-diff.js';
import { listRunCubes, latestOkRunId } from '../src/services/cube-parity/cube-yaml-snapshot-reader.js';

const DEV_RECHARGE_A = `cubes:
  - name: recharge
    sql_table: etl.recharge
    dimensions:
      - name: transid
        sql: transid
        primary_key: true
    measures:
      - name: total
        type: sum
        sql: amount
      - name: arppu
        type: number
        sql: "{total} / {users}"
    joins:
      - name: mf_users
        sql: x
        relationship: many_to_one
`;

const DEV_RECHARGE_B = DEV_RECHARGE_A.replace('sql_table: etl.recharge', 'sql_table: etl.recharge_v2');

const PROD_RECHARGE = `cubes:
  - name: cfm_vn__recharge
    sql_table: std.recharge
    dimensions:
      - name: composite
        sql: composite
        primary_key: true
    measures:
      - name: total
        type: count
      - name: only_prod
        type: sum
`;

const DEV_ONLY = `cubes:
  - name: garden_daily
    sql_table: etl.garden
    measures:
      - name: cnt
        type: count
`;

let db: ReturnType<typeof getDb>;
const fileDev = join(tmp, 'recharge.dev.yml');
const fileProd = join(tmp, 'recharge.prod.yml');
const fileDevOnly = join(tmp, 'garden.dev.yml');

function output(snaps: HarnessOutput['snapshots']): HarnessOutput {
  return {
    generatedAt: '2026-06-21T00:00:00.000Z',
    prodRoot: '/x',
    games: [{ game: 'cfm' }],
    counts: { correctness: 0, parity: 0, cosmetic: 0 },
    parseErrors: [],
    snapshots: snaps,
    findings: [],
  };
}

const META = { startedAt: 1_700_000_000_000, devSha: 'dev1', prodSha: 'prod1' };

beforeAll(() => {
  db = getDb();
  writeFileSync(fileProd, PROD_RECHARGE);
  writeFileSync(fileDevOnly, DEV_ONLY);
});

afterAll(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('extractCubeShape', () => {
  it('matches a prefixed oracle name to its bare logical name', () => {
    const shape = extractCubeShape(PROD_RECHARGE, 'recharge');
    expect(shape?.cubeName).toBe('cfm_vn__recharge');
    expect(shape?.primaryKeys).toEqual(['composite']);
    expect(shape?.sqlTable).toBe('std.recharge');
  });

  it('returns null when no cube matches and the file has many', () => {
    const multi = `cubes:\n  - name: a\n  - name: b\n`;
    expect(extractCubeShape(multi, 'recharge')).toBeNull();
  });
});

describe('structuredDiff', () => {
  it('reports pk/sqlTable/measure/join changes (dev=after, prod=before)', () => {
    const dev = extractCubeShape(DEV_RECHARGE_A, 'recharge');
    const prod = extractCubeShape(PROD_RECHARGE, 'recharge');
    const d = structuredDiff(dev, prod);
    expect(d.devPresent && d.prodPresent).toBe(true);
    const byField = (f: string) => d.changes.filter((c) => c.field === f);
    expect(byField('pk')[0]).toMatchObject({ kind: 'changed', before: 'composite', after: 'transid' });
    expect(byField('sqlTable')[0]).toMatchObject({ before: 'std.recharge', after: 'etl.recharge' });
    expect(byField('measure')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'added', name: 'arppu' }),
        expect.objectContaining({ kind: 'removed', name: 'only_prod' }),
        expect.objectContaining({ kind: 'changed', name: 'total', before: 'count', after: 'sum' }),
      ]),
    );
    expect(byField('join')[0]).toMatchObject({ kind: 'added', name: 'mf_users' });
  });

  it('flags one-sided presence (no counterpart)', () => {
    const d = structuredDiff(extractCubeShape(DEV_ONLY, 'garden_daily'), null);
    expect(d.devPresent).toBe(true);
    expect(d.prodPresent).toBe(false);
    expect(d.changes).toHaveLength(0);
  });
});

describe('unifiedTextDiff', () => {
  it('counts added/removed and preserves context', () => {
    const t = unifiedTextDiff('a\nb\nc\n', 'a\nB\nc\n');
    expect(t.added).toBe(1);
    expect(t.removed).toBe(1);
    expect(t.lines.some((l) => l.kind === 'ctx' && l.text === 'a')).toBe(true);
    expect(t.lines.some((l) => l.kind === 'del' && l.text === 'b')).toBe(true);
    expect(t.lines.some((l) => l.kind === 'add' && l.text === 'B')).toBe(true);
  });
});

describe('orchestrator over persisted snapshots', () => {
  it('diffDevVsProd pairs dev↔prod from the latest run', () => {
    writeFileSync(fileDev, DEV_RECHARGE_A);
    persistRun(
      output([
        { side: 'dev', game: 'cfm', cube: 'recharge', path: 'dev/cfm/recharge.yml', absPath: fileDev },
        { side: 'prod', game: 'cfm', cube: 'recharge', path: 'oracle/cfm_vn/recharge.yml', absPath: fileProd },
        { side: 'dev', game: 'cfm', cube: 'garden_daily', path: 'dev/cfm/garden.yml', absPath: fileDevOnly },
      ]),
      META,
    );
    const diff = diffDevVsProd('cfm', 'recharge');
    expect(diff).not.toBeNull();
    expect(diff!.noCounterpart).toBe(false);
    expect(diff!.structured.changes.some((c) => c.field === 'pk')).toBe(true);
    expect(diff!.text.added).toBeGreaterThan(0);
  });

  it('marks no-counterpart for a dev-only cube', () => {
    const diff = diffDevVsProd('cfm', 'garden_daily');
    expect(diff!.noCounterpart).toBe(true);
    expect(diff!.structured.prodPresent).toBe(false);
  });

  it('listRunCubes tags prod counterpart presence', () => {
    const rid = latestOkRunId(db)!;
    const cubes = listRunCubes(db, rid);
    expect(cubes.find((c) => c.cube === 'recharge')?.hasProd).toBe(true);
    expect(cubes.find((c) => c.cube === 'garden_daily')?.hasProd).toBe(false);
  });

  it('diffDevVersions + version timeline track dev content changes across runs', () => {
    const run1 = latestOkRunId(db)!; // recharge = version A
    writeFileSync(fileDev, DEV_RECHARGE_B); // change dev content
    const r2 = persistRun(
      output([
        { side: 'dev', game: 'cfm', cube: 'recharge', path: 'dev/cfm/recharge.yml', absPath: fileDev },
        { side: 'prod', game: 'cfm', cube: 'recharge', path: 'oracle/cfm_vn/recharge.yml', absPath: fileProd },
      ]),
      META,
    );
    const vDiff = diffDevVersions('cfm', 'recharge', run1, r2.runId);
    expect(vDiff).not.toBeNull();
    expect(vDiff!.text.added + vDiff!.text.removed).toBeGreaterThan(0);

    const versions = listCubeVersions('cfm', 'recharge');
    expect(versions.length).toBe(2);
    expect(versions[0].changed).toBe(false); // first seen
    expect(versions[1].changed).toBe(true); // content differs from prior
  });
});
