/**
 * Agent-visibility rules at the /meta fetch boundary.
 *
 * The cache strips two cube classes before any downstream consumer sees them:
 *   - views (`type: 'view'`) — artifacts must stay join-explorable in /build
 *   - raw `std_*` table passthroughs — pipeline surfaces, not analyst
 *     semantics; the curated cubes built on them are the supported entry
 *     points. Must match both bare (`std_…`) and game-prefixed (`cfm_std_…`)
 *     names so prefix-model workspaces are covered too.
 */

import { describe, it, expect } from 'vitest';
import { isRawStdTableCube } from '../../src/core/cube-meta-cache.js';

describe('isRawStdTableCube', () => {
  it('flags bare std_ cube names (game_id workspaces)', () => {
    expect(isRawStdTableCube('std_ingame_user_recharge_daily')).toBe(true);
    expect(isRawStdTableCube('std_login')).toBe(true);
  });

  it('flags game-prefixed std_ cube names (prefix workspaces)', () => {
    expect(isRawStdTableCube('cfm_std_ingame_user_recharge_daily')).toBe(true);
    expect(isRawStdTableCube('ballistar_std_login')).toBe(true);
  });

  it('keeps curated cubes even when their SOURCE table is std_-backed', () => {
    // user_recharge_daily reads std_ingame_user_recharge_daily but is the
    // preferred analyst surface — only the cube NAME gates visibility.
    expect(isRawStdTableCube('user_recharge_daily')).toBe(false);
    expect(isRawStdTableCube('cfm_user_recharge_daily')).toBe(false);
    expect(isRawStdTableCube('mf_users')).toBe(false);
    expect(isRawStdTableCube('recharge')).toBe(false);
  });

  it('does not over-match names merely containing "std" without the prefix shape', () => {
    expect(isRawStdTableCube('standard_metrics')).toBe(false);
    expect(isRawStdTableCube('mystd_table')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isRawStdTableCube(undefined)).toBe(false);
    expect(isRawStdTableCube(null)).toBe(false);
    expect(isRawStdTableCube(42)).toBe(false);
  });
});
