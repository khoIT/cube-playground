/**
 * Unit tests for the workspace registry loader + resolver.
 *
 * Covers: env-path override, cwd resolution, validation rejection (fallback),
 * resolveWorkspace fallback to default, unknown id → null.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadWorkspacesConfig,
  resolveWorkspace,
  listWorkspacesPublic,
  __resetWorkspacesConfigCache,
} from '../src/services/workspaces-config-loader.js';

let dir: string;
let prevCwd: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  prevCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'ws-loader-'));
  process.chdir(dir);
  savedEnv.WORKSPACES_CONFIG_PATH = process.env.WORKSPACES_CONFIG_PATH;
  delete process.env.WORKSPACES_CONFIG_PATH;
  __resetWorkspacesConfigCache();
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
  __resetWorkspacesConfigCache();
  if (savedEnv.WORKSPACES_CONFIG_PATH === undefined) {
    delete process.env.WORKSPACES_CONFIG_PATH;
  } else {
    process.env.WORKSPACES_CONFIG_PATH = savedEnv.WORKSPACES_CONFIG_PATH;
  }
});

const VALID = JSON.stringify({
  default: 'prod',
  workspaces: [
    {
      id: 'local',
      label: 'Local',
      cubeApiUrl: 'http://localhost:4000',
      authMode: 'minted',
      gameModel: 'game_id',
    },
    {
      id: 'prod',
      label: 'Prod',
      cubeApiUrl: 'https://cube.example.com',
      authMode: 'none',
      gameModel: 'prefix',
      gamePrefixMap: { cfm_vn: 'cfm' },
    },
  ],
});

describe('workspaces-config-loader', () => {
  it('reads workspaces.config.json from cwd', () => {
    writeFileSync(join(dir, 'workspaces.config.json'), VALID);
    __resetWorkspacesConfigCache();
    const cfg = loadWorkspacesConfig();
    expect(cfg.default).toBe('prod');
    expect(cfg.workspaces.map((w) => w.id).sort()).toEqual(['local', 'prod']);
  });

  it('honors WORKSPACES_CONFIG_PATH env override', () => {
    const path = join(dir, 'custom-ws.json');
    writeFileSync(path, VALID);
    process.env.WORKSPACES_CONFIG_PATH = path;
    __resetWorkspacesConfigCache();
    const cfg = loadWorkspacesConfig();
    expect(cfg.default).toBe('prod');
  });

  it('falls back when the file is malformed', () => {
    writeFileSync(join(dir, 'workspaces.config.json'), '{ not json');
    __resetWorkspacesConfigCache();
    const cfg = loadWorkspacesConfig();
    expect(cfg.workspaces).toHaveLength(1);
    expect(cfg.workspaces[0].id).toBe('local');
  });

  it('falls back when default does not match any workspace id', () => {
    writeFileSync(
      join(dir, 'workspaces.config.json'),
      JSON.stringify({
        default: 'missing',
        workspaces: [
          {
            id: 'local',
            label: 'Local',
            cubeApiUrl: 'http://localhost:4000',
            authMode: 'minted',
            gameModel: 'game_id',
          },
        ],
      }),
    );
    __resetWorkspacesConfigCache();
    const cfg = loadWorkspacesConfig();
    // Fallback registry — single 'local' default.
    expect(cfg.default).toBe('local');
  });

  it('resolveWorkspace returns default for empty id, the named workspace otherwise, null for unknown', () => {
    writeFileSync(join(dir, 'workspaces.config.json'), VALID);
    __resetWorkspacesConfigCache();
    expect(resolveWorkspace()?.id).toBe('prod');
    expect(resolveWorkspace('')?.id).toBe('prod');
    expect(resolveWorkspace('local')?.id).toBe('local');
    expect(resolveWorkspace('bogus')).toBeNull();
  });

  it('listWorkspacesPublic strips cubeApiUrl and marks default', () => {
    writeFileSync(join(dir, 'workspaces.config.json'), VALID);
    __resetWorkspacesConfigCache();
    const out = listWorkspacesPublic();
    expect(out).toHaveLength(2);
    for (const w of out) expect(w).not.toHaveProperty('cubeApiUrl');
    const prod = out.find((w) => w.id === 'prod');
    expect(prod?.isDefault).toBe(true);
    expect(prod?.gamePrefixMap?.cfm_vn).toBe('cfm');
  });
});
