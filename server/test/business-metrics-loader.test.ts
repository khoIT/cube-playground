/**
 * business-metrics-loader tests:
 *   - loadAll() reads valid YAMLs, skips malformed (logging the file path).
 *   - writeMetric() is atomic — no partial files on simulated failure.
 *   - duplicate ids are skipped, not overwritten.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  clearCache,
  getAll,
  getById,
  loadAll,
  setRegistryDir,
  seedRegistryFromBaked,
  writeMetric,
} from '../src/services/business-metrics-loader.js';

let dir: string;
let warn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bm-loader-'));
  setRegistryDir(dir);
  clearCache();
  warn = vi.fn();
});

afterEach(() => {
  clearCache();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const VALID_DAU = `
id: dau
label: DAU
description: Daily Active Users
tier: 1
domain: engagement
owner: data-platform@vng
trust: certified
formula:
  type: measure
  ref: mf_users.dau
`;

const VALID_ARPDAU = `
id: arpdau
label: ARPDAU
description: Average revenue per DAU
tier: 1
domain: revenue
owner: data-platform@vng
trust: certified
formula:
  type: ratio
  numerator: recharge.revenue_vnd
  denominator: mf_users.dau
`;

describe('business-metrics-loader', () => {
  it('loads valid YAMLs into the cache', async () => {
    writeFileSync(join(dir, 'dau.yml'), VALID_DAU);
    writeFileSync(join(dir, 'arpdau.yml'), VALID_ARPDAU);

    const result = await loadAll({ warn });

    expect(result.loaded).toBe(2);
    expect(result.skipped).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    expect(getAll().map((m) => m.id).sort()).toEqual(['arpdau', 'dau']);
  });

  it('skips malformed YAML and logs the offending file', async () => {
    writeFileSync(join(dir, 'dau.yml'), VALID_DAU);
    writeFileSync(join(dir, 'broken.yml'), 'id: nope\n  : : invalid');

    const result = await loadAll({ warn });

    expect(result.loaded).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].file).toBe('broken.yml');
    expect(warn).toHaveBeenCalled();
    expect(getById('dau')).toBeDefined();
    expect(getById('nope')).toBeUndefined();
  });

  it('skips files that fail Zod validation', async () => {
    writeFileSync(
      join(dir, 'bad.yml'),
      'id: bad\nlabel: Bad\ntier: 99\ndomain: unknown\nowner: x\ntrust: certified\nformula:\n  type: measure\n  ref: foo.bar\n',
    );

    const result = await loadAll({ warn });

    expect(result.loaded).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('skips a duplicate id and keeps the first-loaded version', async () => {
    writeFileSync(join(dir, 'a-dau.yml'), VALID_DAU);
    writeFileSync(join(dir, 'b-dau.yml'), VALID_DAU);

    const result = await loadAll({ warn });

    expect(result.loaded).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('duplicate');
  });

  it('writeMetric writes atomically (no .tmp file left)', async () => {
    await loadAll({ warn });
    await writeMetric({
      id: 'new_metric',
      label: 'New',
      description: 'Description',
      tier: 4,
      domain: 'engagement',
      owner: 'team@vng',
      trust: 'draft',
      formula: { type: 'measure', ref: 'cube.member' },
    });

    expect(existsSync(join(dir, 'new_metric.yml'))).toBe(true);
    expect(existsSync(join(dir, 'new_metric.yml.tmp'))).toBe(false);
    const files = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(files).toHaveLength(0);
    expect(getById('new_metric')?.label).toBe('New');
  });

  it('writeMetric updates the in-memory cache immediately', async () => {
    await loadAll({ warn });
    await writeMetric({
      id: 'fresh',
      label: 'Fresh',
      description: 'A fresh metric',
      tier: 3,
      domain: 'revenue',
      owner: 'owner@vng',
      trust: 'draft',
      formula: { type: 'measure', ref: 'recharge.revenue_vnd' },
    });

    expect(getById('fresh')?.label).toBe('Fresh');
    expect(getAll().some((m) => m.id === 'fresh')).toBe(true);
  });
});

// `dir` (set in beforeEach) stands in for the prod /data volume; the baked
// default registry (src/presets/business-metrics) is the seed source.
describe('seedRegistryFromBaked — volume durability', () => {
  it('seeds baked presets into an empty volume dir, then loads them', async () => {
    const { copied } = await seedRegistryFromBaked({ warn });

    expect(copied).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'revenue.yml'))).toBe(true);
    expect(existsSync(join(dir, 'dau.yml'))).toBe(true);

    const res = await loadAll({ warn });
    expect(res.loaded).toBe(copied);
    expect(getById('revenue')).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not clobber a metric already present on the volume (copy-if-missing)', async () => {
    // Simulate a runtime-edited metric already on the volume.
    const edited =
      'id: revenue\nlabel: EDITED ON VOLUME\ndescription: d\ntier: 1\ndomain: revenue\nowner: x\ntrust: draft\nformula:\n  type: measure\n  ref: recharge.revenue_vnd\n';
    writeFileSync(join(dir, 'revenue.yml'), edited);

    await seedRegistryFromBaked({ warn });

    // The existing file is preserved verbatim; sibling baked metrics still seed.
    expect(readFileSync(join(dir, 'revenue.yml'), 'utf8')).toBe(edited);
    expect(existsSync(join(dir, 'dau.yml'))).toBe(true);

    await loadAll({ warn });
    expect(getById('revenue')?.label).toBe('EDITED ON VOLUME');
  });
});
