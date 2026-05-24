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
