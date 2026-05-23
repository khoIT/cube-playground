/**
 * games-config-loader path resolution.
 *
 * Regression: when the server is started from a subdirectory (e.g.
 * `npm --prefix server run dev` => cwd is `server/`), `process.cwd()` alone
 * misses the repo-root `gds.config.json` and the loader silently returns the
 * single-game FALLBACK. The picker then only shows "Play Together".
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadGamesConfig,
  __resetGamesConfigCache,
} from '../src/services/games-config-loader.js';

let prevCwd: string;
let tempDir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  prevCwd = process.cwd();
  tempDir = mkdtempSync(join(tmpdir(), 'gds-config-'));
  savedEnv = process.env.GDS_CONFIG_PATH;
  delete process.env.GDS_CONFIG_PATH;
  __resetGamesConfigCache();
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tempDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.GDS_CONFIG_PATH;
  else process.env.GDS_CONFIG_PATH = savedEnv;
  __resetGamesConfigCache();
});

describe('loadGamesConfig path resolution', () => {
  it('does not return the single-game FALLBACK when cwd lacks gds.config.json (npm --prefix server scenario)', () => {
    // Pre-fix: with cwd=tempDir (no gds.config.json), loader returned the
    // single-game FALLBACK so the picker showed only "Play Together".
    process.chdir(tempDir);
    const cfg = loadGamesConfig();
    // The fix walks up from the module path to the repo-root gds.config.json,
    // which always carries ballistar (added when per-game scoping shipped).
    expect(cfg.games.length).toBeGreaterThan(1);
    expect(cfg.games.map((g) => g.id)).toContain('ballistar');
  });

  it('honors GDS_CONFIG_PATH env override regardless of cwd', () => {
    const altPath = join(tempDir, 'custom.json');
    writeFileSync(
      altPath,
      JSON.stringify({
        defaultGameId: 'only',
        games: [{ id: 'only', name: 'Only Game' }],
      }),
    );
    process.env.GDS_CONFIG_PATH = altPath;
    process.chdir(tempDir);
    const cfg = loadGamesConfig();
    expect(cfg.defaultGameId).toBe('only');
    expect(cfg.games).toEqual([{ id: 'only', name: 'Only Game' }]);
  });

  it('prefers cwd/gds.config.json when present (existing test-fixture behavior)', () => {
    writeFileSync(
      join(tempDir, 'gds.config.json'),
      JSON.stringify({
        defaultGameId: 'fixture',
        games: [{ id: 'fixture', name: 'Fixture Game' }],
      }),
    );
    process.chdir(tempDir);
    const cfg = loadGamesConfig();
    expect(cfg.games).toEqual([{ id: 'fixture', name: 'Fixture Game' }]);
  });
});
