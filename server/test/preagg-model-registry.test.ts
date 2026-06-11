/**
 * Tests for preagg-model-registry: deriving per-game probe entries from
 * cube-dev model YAML (dir matching, rollup selection, lambda skipping,
 * fallback signalling).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getModelPreaggRegistry,
  __resetModelRegistryCache,
} from '../src/services/preagg-model-registry.js';

let root: string;

const RECHARGE_YML = `
cubes:
  - name: recharge
    sql_table: etl_ingame_recharge
    measures:
      - name: revenue_vnd
        type: sum
    pre_aggregations:
      - name: revenue_daily_by_channel_batch
        type: rollup
        measures:
          - revenue_vnd
          - transactions
        dimensions:
          - payment_channel
        time_dimension: recharge_time
        granularity: day
`;

const MF_USERS_YML = `
cubes:
  - name: mf_users
    sql_table: mf_users
    pre_aggregations:
      - name: user_composition
        type: rollup_lambda
        union_with_source_data: true
        rollups:
          - CUBE.user_composition_batch
      - name: user_composition_batch
        type: rollup
        measures:
          - user_count_approx
        dimensions:
          - country
        time_dimension: install_date
        granularity: day
`;

const NO_PREAGG_YML = `
cubes:
  - name: plain_cube
    sql_table: plain
    measures:
      - name: count
        type: count
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'preagg-model-'));
  process.env.PREAGG_MODEL_CUBES_DIR = root;
  __resetModelRegistryCache();
});

afterEach(() => {
  delete process.env.PREAGG_MODEL_CUBES_DIR;
  rmSync(root, { recursive: true, force: true });
  __resetModelRegistryCache();
});

function writeGame(dir: string, files: Record<string, string>): void {
  mkdirSync(join(root, dir), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, dir, name), body);
  }
}

describe('getModelPreaggRegistry', () => {
  it('derives one probe entry per pre-agg-bearing cube, qualifying members', () => {
    writeGame('ptg', { 'recharge.yml': RECHARGE_YML, 'plain.yml': NO_PREAGG_YML });
    const entries = getModelPreaggRegistry('ptg');
    expect(entries).toEqual([
      {
        cube: 'recharge',
        measure: 'recharge.revenue_vnd',
        timeDimension: 'recharge.recharge_time',
      },
    ]);
  });

  it('skips rollup_lambda and probes the underlying batch rollup', () => {
    writeGame('cfm', { 'mf_users.yml': MF_USERS_YML });
    const entries = getModelPreaggRegistry('cfm_vn'); // suffix id → cfm dir
    expect(entries).toEqual([
      {
        cube: 'mf_users',
        measure: 'mf_users.user_count_approx',
        timeDimension: 'mf_users.install_date',
      },
    ]);
  });

  it('returns [] for a game dir with no rollups (honest empty, no fallback)', () => {
    writeGame('cros', { 'plain.yml': NO_PREAGG_YML });
    expect(getModelPreaggRegistry('cros')).toEqual([]);
  });

  it('returns null when no dir matches the game id (caller falls back)', () => {
    writeGame('ptg', { 'recharge.yml': RECHARGE_YML });
    expect(getModelPreaggRegistry('unknown_game')).toBeNull();
  });

  it('survives a malformed YAML without blanking the rest of the game', () => {
    writeGame('jus', { 'broken.yml': '{{{not yaml', 'recharge.yml': RECHARGE_YML });
    const entries = getModelPreaggRegistry('jus_vn');
    expect(entries).toHaveLength(1);
    expect(entries?.[0].cube).toBe('recharge');
  });
});
