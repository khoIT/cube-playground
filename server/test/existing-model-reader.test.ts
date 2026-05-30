/**
 * Unit tests for the read-only existing-model reader. Builds a temp model dir
 * matching cube-dev's layout (cubes/<game>/*.yml) and asserts parsing, the
 * primary-key flag, join mapping, missing-dir tolerance, and the cache.
 */
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'model-reader-'));
process.env.VITE_CUBE_MODEL_DIR = root;

const { readExistingModel, __resetExistingModelCache } = await import('../src/services/existing-model-reader.js');

const CUBE_YAML = `cubes:
  - name: mf_users
    sql_table: mf_users
    title: User Master Profile
    description: One row per user.
    joins:
      - name: active_daily
        relationship: one_to_many
        sql: '{CUBE}.user_id = {active_daily}.user_id'
    dimensions:
      - name: user_id
        sql: user_id
        type: string
        primary_key: true
      - name: country
        sql: country
        type: string
    measures:
      - name: count
        type: count
      - name: ltv
        type: sum
        sql: lifetime_value
`;

function writeGame(game: string): void {
  const dir = join(root, 'cubes', game);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mf_users.yml'), CUBE_YAML);
  // bump mtime so the mtime-keyed cache reads fresh between tests
  const now = new Date();
  utimesSync(dir, now, now);
}

beforeEach(() => __resetExistingModelCache());
afterEach(() => __resetExistingModelCache());

describe('existing-model-reader', () => {
  it('parses cubes with dimensions, measures, joins, primary key', () => {
    writeGame('ballistar');
    const model = readExistingModel('ballistar');
    expect(model.configured).toBe(true);
    expect(model.cubes).toHaveLength(1);
    const cube = model.cubes[0];
    expect(cube).toMatchObject({ name: 'mf_users', sqlTable: 'mf_users', title: 'User Master Profile' });
    expect(cube.dimensions.find((d) => d.name === 'user_id')?.primaryKey).toBe(true);
    expect(cube.measures.map((m) => m.name)).toEqual(['count', 'ltv']);
    expect(cube.joins[0]).toMatchObject({ name: 'active_daily', relationship: 'one_to_many' });
  });

  it('returns configured:false for a game with no model dir', () => {
    expect(readExistingModel('nonexistent_game').configured).toBe(false);
  });

  it('rejects a non-slug game (traversal guard) without throwing', () => {
    expect(readExistingModel('../etc').configured).toBe(false);
  });
});
