import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import { resolveIdentityField } from '../src/services/resolve-identity-field.js';
import * as wsConfig from '../src/services/workspaces-config-loader.js';
import * as suggester from '../src/services/identity-suggester.js';
import type { WorkspaceDef } from '../src/services/workspaces-config-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

// Deployment default is a PREFIX workspace (mirrors prod), but the segment
// being refreshed lives on a game_id workspace.
const PREFIX_DEFAULT: WorkspaceDef = {
  id: 'prod',
  label: 'Prod (prefix)',
  cubeApiUrl: 'https://cube.example',
  authMode: 'none',
  gameModel: 'prefix',
  gamePrefixMap: { ballistar: 'ballistar' },
};
const GAMEID_LOCAL: WorkspaceDef = {
  id: 'local',
  label: 'Local (game_id)',
  cubeApiUrl: 'http://cube_api:4000',
  authMode: 'minted',
  gameModel: 'game_id',
};

function seedOverride() {
  // Manual override stored in LOGICAL space (as the PUT handler writes it).
  getDb()
    .prepare(
      `INSERT INTO cube_identity_map (cube, identity_field, source, confidence, updated_at)
       VALUES ('recharge', 'recharge.user_id', 'manual', 1, ?)`,
    )
    .run(new Date().toISOString());
}

describe('resolveIdentityField — prefix derives from the segment workspace, not the default', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    vi.restoreAllMocks();
    vi.spyOn(wsConfig, 'getDefaultWorkspace').mockReturnValue(PREFIX_DEFAULT);
    vi.spyOn(wsConfig, 'resolveWorkspace').mockImplementation((id) =>
      id === 'local' ? GAMEID_LOCAL : id === 'prod' ? PREFIX_DEFAULT : null,
    );
  });
  afterEach(() => closeDb());

  it('keeps a manual override LOGICAL for a game_id-workspace segment (no false physicalization)', async () => {
    seedOverride();
    // Segment is on the game_id `local` workspace → prefix must be null even
    // though the deployment default is the prefix workspace.
    const field = await resolveIdentityField('recharge', 'ballistar', { workspaceId: 'local' });
    expect(field).toBe('recharge.user_id');
  });

  it('physicalizes the override for a prefix-workspace segment', async () => {
    seedOverride();
    const field = await resolveIdentityField('recharge', 'ballistar', { workspaceId: 'prod' });
    expect(field).toBe('ballistar_recharge.user_id');
  });

  it('without a workspaceId, falls back to the (prefix) default workspace', async () => {
    seedOverride();
    const field = await resolveIdentityField('recharge', 'ballistar');
    expect(field).toBe('ballistar_recharge.user_id');
  });

  it('auto-suggest path: game_id segment matches the logical suggestion', async () => {
    // No override → auto-suggest. game_id workspace → prefix null → compare logical.
    vi.spyOn(suggester, 'suggestIdentities').mockResolvedValue([
      { cube: 'recharge', identity_field: 'recharge.user_id', confidence: 0.95, matched_pattern: 'user_id' },
    ]);
    const field = await resolveIdentityField('recharge', 'ballistar', { workspaceId: 'local' });
    expect(field).toBe('recharge.user_id');
  });
});
