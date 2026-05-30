/**
 * Atomic-write + rollback tests for the cube-model writer. Real filesystem
 * (temp model dir), mocked `fetch` for the /meta poll. Proves: a successful
 * poll keeps the file; a failed poll rolls back (deletes a new file / restores
 * a prior one).
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeCubeModel, cubeFilePath, resolveModelDir, CubeModelWriteError } from '../src/services/cube-model-writer.js';

let root: string;
const realFetch = globalThis.fetch;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cube-writer-'));
  process.env.VITE_CUBE_MODEL_DIR = root;
  delete process.env.NODE_ENV; // not production → write enabled
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

function mockMeta(hasCube: boolean): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({ cubes: hasCube ? [{ name: 'active_daily', measures: [{ name: 'active_daily.count' }] }] : [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
}

const yaml = 'cubes:\n  - name: active_daily\n    sql_table: ballistar_vn.active_daily\n';

describe('writeCubeModel — success', () => {
  it('writes the file under cubes/<game>/ and confirms via /meta', async () => {
    mockMeta(true);
    const res = await writeCubeModel({
      game: 'ballistar',
      cubeName: 'active_daily',
      yaml,
      cubeApiUrl: 'http://cube',
      token: 't',
      pollTimeoutMs: 500,
      pollIntervalMs: 50,
    });
    expect(res.metaAcknowledged).toBe(true);
    const target = cubeFilePath(resolveModelDir(), 'ballistar', 'active_daily');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(yaml);
  });
});

describe('writeCubeModel — rollback on failed /meta poll', () => {
  it('deletes a newly-created file when the cube never appears', async () => {
    mockMeta(false);
    const target = cubeFilePath(resolveModelDir(), 'ballistar', 'active_daily');
    await expect(
      writeCubeModel({ game: 'ballistar', cubeName: 'active_daily', yaml, cubeApiUrl: 'http://cube', token: 't', pollTimeoutMs: 300, pollIntervalMs: 50 }),
    ).rejects.toThrow(CubeModelWriteError);
    expect(existsSync(target)).toBe(false);
  });

  it('restores the prior file content on overwrite rollback', async () => {
    mockMeta(false);
    const target = cubeFilePath(resolveModelDir(), 'ballistar', 'active_daily');
    mkdirSync(join(root, 'cubes', 'ballistar'), { recursive: true });
    writeFileSync(target, 'PRIOR', 'utf8');
    await expect(
      writeCubeModel({ game: 'ballistar', cubeName: 'active_daily', yaml, cubeApiUrl: 'http://cube', token: 't', pollTimeoutMs: 300, pollIntervalMs: 50 }),
    ).rejects.toThrow(CubeModelWriteError);
    expect(readFileSync(target, 'utf8')).toBe('PRIOR');
  });
});

describe('writeCubeModel — guards', () => {
  it('refuses when VITE_CUBE_MODEL_DIR is unset', async () => {
    delete process.env.VITE_CUBE_MODEL_DIR;
    await expect(
      writeCubeModel({ game: 'ballistar', cubeName: 'x', yaml, cubeApiUrl: 'http://cube', token: null }),
    ).rejects.toMatchObject({ code: 'model-dir-not-configured' });
  });
});
