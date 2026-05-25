/**
 * Regression: getDb() must resolve DB_PATH lazily on first call, not at module
 * load. ES module imports are hoisted, so test files that set
 * `process.env.DB_PATH = …` at top level would otherwise race against the
 * import of sqlite.ts and silently open the real dev DB. This test asserts
 * the lazy contract.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'sqlite-lazy-test-'));

// Set DB_PATH BEFORE importing — the lazy resolver must pick this up even
// though the module load happens via ESM hoisting first.
process.env.DB_PATH = join(tmp, 'lazy.db');

import { getDb, closeDb } from '../src/db/sqlite.js';

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('getDb lazy DB_PATH resolution', () => {
  it('opens the path set in process.env.DB_PATH at first call, not the dev default', () => {
    const db = getDb();
    // sqlite exposes the open file via the `name` property on Database instances.
    expect(db.name).toBe(join(tmp, 'lazy.db'));
    expect(db.name).not.toContain('data/segments.db');
  });
});
